// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, readBody, setCors } from '../../api/_http.js'
import startHandler from '../../api/auth/github/start.js'
import callbackHandler from '../../api/auth/github/callback.js'
import logoutHandler from '../../api/auth/logout.js'
import sessionHandler from '../../api/auth/session.js'
import { createSubmissionHandler } from '../../api/events/submissions/index.js'
import { createEditRequestHandler } from '../../api/events/[eventId]/edit-requests.js'
import {
  createRequest,
  createResponse,
  type ApiEnvironment,
  type TestRequest,
} from './apiTestHarness'

const JSON_LIMIT_BYTES = 16 * 1024
const STRONG_SECRET = 'miku-call-guide-test-secret-32-bytes-minimum'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const testEnv: ApiEnvironment = {
  APP_ENV: 'test',
  APP_ORIGIN: 'https://app.example.test',
  SESSION_SECRET: STRONG_SECRET,
}

function jsonRequest(body: unknown, contentType = 'application/json'): TestRequest {
  return createRequest({
    body,
    env: testEnv,
    headers: { 'content-type': contentType },
    method: 'POST',
  })
}

function exactSizeJson(byteLength: number): string {
  const framingBytes = Buffer.byteLength(JSON.stringify({ value: '' }), 'utf8')
  const payloadBytes = byteLength - framingBytes
  const multibyteCharacters = Math.floor(payloadBytes / 3)
  const asciiCharacters = payloadBytes - (multibyteCharacters * 3)
  const result = JSON.stringify({
    value: `${'가'.repeat(multibyteCharacters)}${'a'.repeat(asciiCharacters)}`,
  })
  expect(Buffer.byteLength(result, 'utf8')).toBe(byteLength)
  return result
}

function expectHttpError(action: () => unknown, status: number, code: string): void {
  try {
    action()
  } catch (error) {
    expect(error).toMatchObject({ code, status })
    return
  }
  throw new Error(`Expected HttpError ${status} ${code}`)
}

function expectStandardError(
  response: ReturnType<typeof createResponse>,
  status: number,
  errorCode: string,
): void {
  expect(response.statusCode).toBe(status)
  expect(response.body).toEqual({
    error: errorCode,
    requestId: expect.stringMatching(UUID_PATTERN),
    ...(response.body && typeof response.body === 'object' && 'details' in response.body
      ? { details: expect.any(Array) }
      : {}),
  })
  expect(response.getHeader('x-request-id')).toBe(
    (response.body as { requestId: string }).requestId,
  )
}

describe('canonical API origin', () => {
  it('allows credentialed CORS for the exact canonical production origin', () => {
    const appOrigin = 'https://app.miku-events.dev'
    const request = createRequest({
      env: {
        APP_ENV: 'production',
        APP_ORIGIN: appOrigin,
      },
      headers: { origin: appOrigin },
    })
    const response = createResponse()

    setCors(request, response)

    expect(response.getHeader('access-control-allow-origin')).toBe(appOrigin)
    expect(response.getHeader('access-control-allow-credentials')).toBe('true')
  })
})

describe('strict JSON request bodies', () => {
  it.each([
    'application/json',
    'Application/JSON; Charset=UTF-8',
    'application/vnd.api+json',
    'APPLICATION/PROBLEM+JSON; charset=utf-8',
  ])('accepts supported content type %s', (contentType) => {
    expect(readBody(jsonRequest('{"value":"ok"}', contentType))).toEqual({ value: 'ok' })
  })

  it('rejects unsupported content types', () => {
    expectHttpError(
      () => readBody(jsonRequest('{"value":"ok"}', 'text/plain')),
      415,
      'unsupported_media_type',
    )
  })

  it('rejects malformed JSON', () => {
    expectHttpError(
      () => readBody(jsonRequest('{"value":')),
      400,
      'invalid_json',
    )
  })

  it('accepts exactly 16 KiB and rejects byte 16385 for multibyte JSON strings', () => {
    expect(readBody(jsonRequest(exactSizeJson(JSON_LIMIT_BYTES)))).toHaveProperty('value')
    expectHttpError(
      () => readBody(jsonRequest(exactSizeJson(JSON_LIMIT_BYTES + 1))),
      413,
      'request_body_too_large',
    )
  })

  it('byte-counts Vercel-like pre-parsed objects', () => {
    const accepted = { value: '가'.repeat(5_457) + 'a' }
    expect(Buffer.byteLength(JSON.stringify(accepted), 'utf8')).toBe(JSON_LIMIT_BYTES)
    expect(readBody(jsonRequest(accepted))).toEqual(accepted)

    const oversized = { value: `${accepted.value}a` }
    expectHttpError(
      () => readBody(jsonRequest(oversized)),
      413,
      'request_body_too_large',
    )
  })
})

describe('standard API errors', () => {
  it.each([
    ['submission', createSubmissionHandler],
    ['edit request', createEditRequestHandler],
  ])('returns session_not_configured when %s session verification fails', async (
    _label,
    createHandler,
  ) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = createHandler({
      readSession: () => {
        throw new Error('raw SESSION_SECRET configuration detail')
      },
    })
    const request = jsonRequest({ turnstileToken: 'token' })
    const response = createResponse()

    await handler(request, response)

    expectStandardError(response, 503, 'session_not_configured')
    expect(JSON.stringify(response.body)).not.toContain('SESSION_SECRET')
    expect(errorLog).toHaveBeenCalledOnce()
  })

  it('returns validation details and ignores a client-provided request ID', async () => {
    const handler = createSubmissionHandler({
      createEventPullRequest: vi.fn(),
      readSession: () => ({ login: 'miku-user' }),
      verifyTurnstileToken: () => Promise.resolve(true),
    })
    const request = jsonRequest({ turnstileToken: 'token' })
    request.headers['x-request-id'] = 'attacker-controlled'
    const response = createResponse()

    await handler(request, response)

    expectStandardError(response, 400, 'invalid_event_submission')
    expect((response.body as { details: string[] }).details).toContain('title is required')
    expect(response.getHeader('x-request-id')).not.toBe('attacker-controlled')
  })

  it('does not disclose upstream exception content', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = createSubmissionHandler({
      createEventPullRequest: () => Promise.reject(
        new Error('GitHub API failed: secret-token and raw response body'),
      ),
      readSession: () => ({ login: 'miku-user' }),
      verifyTurnstileToken: () => Promise.resolve(true),
    })
    const request = jsonRequest({
      snsUrl: 'https://x.com/miku',
      startsAt: '2026-08-15T18:00:00Z',
      timezone: 'Asia/Seoul',
      title: 'Hatsune Miku Concert',
      turnstileToken: 'token',
      type: 'concert',
    })
    const response = createResponse()

    await handler(request, response)

    expectStandardError(response, 502, 'github_upstream_failed')
    expect(JSON.stringify(response.body)).not.toContain('secret-token')
    expect(JSON.stringify(response.body)).not.toContain('raw response body')
    expect(errorLog).toHaveBeenCalledOnce()
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toEqual({
      endpoint: '/api/test',
      githubUser: 'miku-user',
      requestId: (response.body as { requestId: string }).requestId,
      resultCode: 'github_upstream_failed',
    })
  })

  it('logs sanitized timeout metadata and preserves the upstream 503 status', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = createSubmissionHandler({
      createEventPullRequest: () => Promise.reject(
        new HttpError(503, 'github_upstream_unavailable'),
      ),
      readSession: () => ({ login: 'miku-user' }),
      verifyTurnstileToken: () => Promise.resolve(true),
    })
    const request = jsonRequest({
      snsUrl: 'https://x.com/miku',
      startsAt: '2026-08-15T18:00:00Z',
      timezone: 'Asia/Seoul',
      title: 'Hatsune Miku Concert',
      turnstileToken: 'token',
      type: 'concert',
    })
    const response = createResponse()

    await handler(request, response)

    expectStandardError(response, 503, 'github_upstream_unavailable')
    expect(errorLog).toHaveBeenCalledOnce()
    expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toEqual({
      endpoint: '/api/test',
      githubUser: 'miku-user',
      requestId: (response.body as { requestId: string }).requestId,
      resultCode: 'github_upstream_unavailable',
    })
  })

  it('standardizes OAuth, session, logout, and method failures', async () => {
    const cases: Array<{
      expectedCode: string
      expectedStatus: number
      invoke: () => Promise<ReturnType<typeof createResponse>>
    }> = [
      {
        expectedCode: 'github_oauth_not_configured',
        expectedStatus: 503,
        invoke: async () => {
          const response = createResponse()
          startHandler(createRequest({ env: testEnv }), response)
          return response
        },
      },
      {
        expectedCode: 'invalid_oauth_callback',
        expectedStatus: 400,
        invoke: async () => {
          const response = createResponse()
          await callbackHandler(createRequest({ env: testEnv }), response)
          return response
        },
      },
      {
        expectedCode: 'method_not_allowed',
        expectedStatus: 405,
        invoke: async () => {
          const response = createResponse()
          sessionHandler(createRequest({ env: testEnv, method: 'POST' }), response)
          return response
        },
      },
      {
        expectedCode: 'method_not_allowed',
        expectedStatus: 405,
        invoke: async () => {
          const response = createResponse()
          logoutHandler(createRequest({ env: testEnv, method: 'GET' }), response)
          return response
        },
      },
    ]

    for (const testCase of cases) {
      expectStandardError(
        await testCase.invoke(),
        testCase.expectedStatus,
        testCase.expectedCode,
      )
    }
  })
})

describe('direct Vercel request environments', () => {
  function stubVercelEnvironment(): void {
    vi.stubEnv('APP_ENV', 'test')
    vi.stubEnv('APP_ORIGIN', 'https://app.example.test')
    vi.stubEnv('SESSION_SECRET', STRONG_SECRET)
    vi.stubEnv('GITHUB_APP_ID', 'vercel-app-id')
    vi.stubEnv('GITHUB_APP_INSTALLATION_ID', 'vercel-installation-id')
    vi.stubEnv('GITHUB_DATA_OWNER', 'vercel-owner')
    vi.stubEnv('GITHUB_DATA_REPO', 'vercel-repo')
  }

  it('passes process.env to a direct event submission write', async () => {
    stubVercelEnvironment()
    const createPullRequest = vi.fn().mockResolvedValue({
      html_url: 'https://github.com/vercel-owner/vercel-repo/pull/7',
    })
    const readRequestSession = vi.fn().mockReturnValue({ login: 'miku-user' })
    const handler = createSubmissionHandler({
      createEventPullRequest: createPullRequest,
      readSession: readRequestSession,
      verifyTurnstileToken: () => Promise.resolve(true),
    })
    const request = createRequest({
      body: {
        snsUrl: 'https://x.com/miku',
        startsAt: '2026-08-15T18:00:00Z',
        timezone: 'Asia/Seoul',
        title: 'Hatsune Miku Concert',
        turnstileToken: 'token',
        type: 'concert',
      },
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      url: 'https://app.example.test/api/events/submissions',
    })
    const response = createResponse()

    await handler(request, response)

    expect(request.env).toBeUndefined()
    expect(readRequestSession).toHaveBeenCalledWith(request, process.env)
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ submitter: 'miku-user' }),
      process.env,
    )
    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({
      url: 'https://github.com/vercel-owner/vercel-repo/pull/7',
    })
  })

  it('passes process.env to a direct event edit write', async () => {
    stubVercelEnvironment()
    const createIssue = vi.fn().mockResolvedValue({
      html_url: 'https://github.com/vercel-owner/vercel-repo/issues/8',
    })
    const readRequestSession = vi.fn().mockReturnValue({ login: 'miku-user' })
    const handler = createEditRequestHandler({
      createEditRequestIssue: createIssue,
      readSession: readRequestSession,
      verifyTurnstileToken: () => Promise.resolve(true),
    })
    const request = createRequest({
      body: {
        message: 'Please correct the start time',
        turnstileToken: 'token',
      },
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      query: { eventId: 'sample-event' },
      url: 'https://app.example.test/api/events/sample-event/edit-requests',
    })
    const response = createResponse()

    await handler(request, response)

    expect(request.env).toBeUndefined()
    expect(readRequestSession).toHaveBeenCalledWith(request, process.env)
    expect(createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'sample-event', submitter: 'miku-user' }),
      process.env,
    )
    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({
      url: 'https://github.com/vercel-owner/vercel-repo/issues/8',
    })
  })
})
