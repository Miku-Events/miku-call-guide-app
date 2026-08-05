// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditRequestHandler } from '../../functions/api/events/[eventId]/edit-requests.js'
import { createSubmissionHandler } from '../../functions/api/events/submissions.js'
import {
  createApiHandler,
  HttpError,
  JSON_BODY_LIMIT_BYTES,
  jsonResponse,
} from '../../functions/_lib/http.js'

const STRONG_SECRET = 'miku-call-guide-test-secret-32-bytes-minimum'
const testEnv = {
  APP_ENV: 'test',
  APP_ORIGIN: 'https://app.example.test',
  SESSION_SECRET: STRONG_SECRET,
}

function context(request: Request, env = testEnv, params: Record<string, string> = {}) {
  return { env, params, request }
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://app.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

afterEach(() => vi.restoreAllMocks())

describe('Pages API handler contract', () => {
  const handler = createApiHandler({ method: 'POST', jsonBody: true }, ({ body, headers }) => (
    jsonResponse({ body }, 200, headers)
  ))

  it('handles OPTIONS without reading the body', async () => {
    const response = await handler(context(new Request('https://app.example.test/api/test', {
      method: 'OPTIONS',
    })))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,POST,OPTIONS')
  })

  it('returns the standard method error and Allow header', async () => {
    const response = await handler(context(new Request('https://app.example.test/api/test')))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(await response.json()).toEqual({ error: 'method_not_allowed', requestId: expect.any(String) })
  })

  it('applies CORS only to the exact configured origin', async () => {
    const allowed = await handler(context(jsonRequest('/api/test', {}, { origin: testEnv.APP_ORIGIN })))
    expect(allowed.headers.get('access-control-allow-origin')).toBe(testEnv.APP_ORIGIN)
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true')

    const denied = await handler(context(jsonRequest('/api/test', {}, { origin: 'https://evil.test' })))
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('ignores an inbound request ID and applies all security headers', async () => {
    const response = await handler(context(jsonRequest('/api/test', {}, { 'x-request-id': 'attacker' })))
    expect(response.headers.get('x-request-id')).not.toBe('attacker')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it.each([
    ['unsupported media type', { 'content-type': 'text/plain' }, '{}', 415, 'unsupported_media_type'],
    ['empty body', {}, '', 400, 'invalid_json'],
    ['malformed JSON', {}, '{', 400, 'invalid_json'],
    ['array JSON', {}, '[]', 400, 'invalid_json'],
    ['scalar JSON', {}, 'true', 400, 'invalid_json'],
    ['declared oversized body', { 'content-length': String(JSON_BODY_LIMIT_BYTES + 1) }, '{}', 413, 'request_body_too_large'],
  ])('rejects %s', async (_label, headers, body, status, error) => {
    const request = new Request('https://app.example.test/api/test', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
    })
    const response = await handler(context(request))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error, requestId: expect.any(String) })
  })

  it('rejects an actually oversized streamed body', async () => {
    const request = jsonRequest('/api/test', JSON.stringify({ value: 'x'.repeat(JSON_BODY_LIMIT_BYTES) }))
    const response = await handler(context(request))
    expect(response.status).toBe(413)
  })

  it('sanitizes unknown and known server errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unknownHandler = createApiHandler({
      method: 'GET', fallback: { code: 'stable_error', status: 502 },
    }, () => { throw new Error('upstream private body') })
    const knownHandler = createApiHandler({ method: 'GET' }, () => {
      throw new HttpError(503, 'service_unavailable')
    })
    for (const [target, code] of [[unknownHandler, 'stable_error'], [knownHandler, 'service_unavailable']] as const) {
      const response = await target(context(new Request('https://app.example.test/api/test')))
      const body = await response.json()
      expect(body).toEqual({ error: code, requestId: expect.any(String) })
      expect(JSON.stringify(body)).not.toContain('private')
    }
    expect(consoleError).toHaveBeenCalledTimes(2)
  })
})

describe('event write handlers', () => {
  const submissionBody = {
    title: 'Miku concert', type: 'concert', timezone: 'Asia/Seoul',
    snsUrl: 'https://x.com/miku', startsOn: '2026-08-05', turnstileToken: 'token',
  }

  it('passes the exact Request env and action through a submission', async () => {
    const createEventPullRequest = vi.fn(async () => ({ html_url: 'https://github.test/pull/1' }))
    const readSession = vi.fn(() => ({ login: 'miku-user' }))
    const verifyTurnstileToken = vi.fn(async () => true)
    const handler = createSubmissionHandler({ createEventPullRequest, readSession, verifyTurnstileToken })
    const request = jsonRequest('/api/events/submissions', submissionBody)
    const response = await handler(context(request))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: 'https://github.test/pull/1' })
    expect(readSession).toHaveBeenCalledWith(request, testEnv)
    expect(verifyTurnstileToken).toHaveBeenCalledWith('token', request, testEnv, 'event_submit')
    expect(createEventPullRequest.mock.calls[0]?.[1]).toBe(testEnv)
  })

  it('uses route params and exact event_edit action', async () => {
    const createEditRequestIssue = vi.fn(async () => ({ html_url: 'https://github.test/issues/1' }))
    const verifyTurnstileToken = vi.fn(async () => true)
    const handler = createEditRequestHandler({
      createEditRequestIssue,
      readSession: () => ({ login: 'miku-user' }),
      verifyTurnstileToken,
    })
    const request = jsonRequest('/api/events/miku-event/edit-requests', {
      message: 'Please correct the date', turnstileToken: 'token',
    })
    const response = await handler(context(request, testEnv, { eventId: 'miku-event' }))
    expect(response.status).toBe(200)
    expect(verifyTurnstileToken).toHaveBeenCalledWith('token', request, testEnv, 'event_edit')
    expect(createEditRequestIssue.mock.calls[0]?.[0]).toMatchObject({ eventId: 'miku-event' })
  })

  it('fails before the upstream call when login or Turnstile is invalid', async () => {
    const createEventPullRequest = vi.fn()
    const unauthenticated = createSubmissionHandler({
      createEventPullRequest, readSession: () => null, verifyTurnstileToken: vi.fn(),
    })
    const invalidToken = createSubmissionHandler({
      createEventPullRequest, readSession: () => ({ login: 'miku' }), verifyTurnstileToken: async () => false,
    })
    expect((await unauthenticated(context(jsonRequest('/api/events/submissions', submissionBody)))).status).toBe(401)
    expect((await invalidToken(context(jsonRequest('/api/events/submissions', submissionBody)))).status).toBe(400)
    expect(createEventPullRequest).not.toHaveBeenCalled()
  })
})
