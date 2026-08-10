// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as editRequestModule from '../../functions/api/events/[eventId]/edit-requests.js'
import * as submissionModule from '../../functions/api/events/submissions.js'
import { setSessionCookie } from '../../functions/_lib/session.js'
import { verifyTurnstileToken as verifyTurnstileTokenImpl } from '../../functions/_lib/turnstile.js'
import {
  asLegacyHandler,
  createRequest,
  createResponse,
  createWebRequest,
  type ApiEnvironment,
  type TestRequest,
} from './apiTestHarness'

const TEST_SECRET = '1x0000000000000000000000000000000AA'
const REAL_SECRET = 'turnstile-secret-for-app-example-test'
const EXPECTED_HOSTNAME = 'app.miku-events.dev'
const SESSION_SECRET = 'turnstile-test-session-secret-that-is-long-enough'

const officialTestSecrets = [
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestWithEnvironment(
  env: ApiEnvironment,
  headers: Record<string, string> = {},
  origin = `https://${EXPECTED_HOSTNAME}`,
) {
  return createRequest({ env, headers, url: `${origin}/api/events/submissions` })
}

function verifyTurnstileToken(
  token: unknown,
  testRequest: TestRequest,
  action: 'event_submit' | 'event_edit',
  options: Parameters<typeof verifyTurnstileTokenImpl>[4] = {},
) {
  return verifyTurnstileTokenImpl(
    token,
    createWebRequest(testRequest),
    testRequest.env ?? {},
    action,
    options,
  )
}

function successfulVerification(action = 'event_submit', hostname = EXPECTED_HOSTNAME) {
  return jsonResponse({ success: true, action, hostname })
}

describe('verifyTurnstileToken', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['null', null],
    ['number', 42],
    ['object', { token: 'value' }],
    ['too long', 'x'.repeat(2049)],
  ])('rejects a %s token without calling Siteverify', async (_label, token) => {
    const fetchImpl = vi.fn(async () => successfulVerification())
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      token,
      requestWithEnvironment({ APP_ENV: 'test' }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['preview', 'production'] as const)(
    'derives the expected hostname from the %s request URL',
    async (appEnvironment) => {
      const customHostname = `${appEnvironment}.next-miku-domain.dev`
      const fetchImpl = vi.fn(async () => successfulVerification('event_submit', customHostname))
      vi.stubGlobal('fetch', fetchImpl)

      const result = await verifyTurnstileToken(
        'valid-token',
        requestWithEnvironment({
          APP_ENV: appEnvironment,
          CLOUDFLARE_TURNSTILE_SECRET_KEY: REAL_SECRET,
          TURNSTILE_EXPECTED_HOSTNAME: 'stale-config.example',
        }, {}, `https://${customHostname}`),
        'event_submit',
        { fetchImpl },
      )

      expect(result).toBe(true)
    },
  )

  it('rejects an insecure request URL in a secure environment before Siteverify', async () => {
    const fetchImpl = vi.fn(async () => successfulVerification())
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({
        APP_ENV: 'production',
        CLOUDFLARE_TURNSTILE_SECRET_KEY: REAL_SECRET,
      }, {}, `http://${EXPECTED_HOSTNAME}`),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([undefined, 'staging'])('rejects invalid APP_ENV %s without a network call', async (appEnvironment) => {
    const fetchImpl = vi.fn(async () => successfulVerification())
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({ APP_ENV: appEnvironment }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed in secure environments with a missing secret', async () => {
    const fetchImpl = vi.fn(async () => successfulVerification())
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({ APP_ENV: 'production' }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(officialTestSecrets)('rejects official test secret %s in production', async (secret) => {
    const fetchImpl = vi.fn(async () => successfulVerification())
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({
        APP_ENV: 'production',
        CLOUDFLARE_TURNSTILE_SECRET_KEY: secret,
      }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['replace-with-turnstile-secret', 'YOUR_TURNSTILE_SECRET', 'changeme'])(
    'rejects placeholder secret %s in preview',
    async (secret) => {
      const fetchImpl = vi.fn(async () => successfulVerification())
      vi.stubGlobal('fetch', fetchImpl)

      const result = await verifyTurnstileToken(
        'valid-token',
        requestWithEnvironment({
          APP_ENV: 'preview',
          CLOUDFLARE_TURNSTILE_SECRET_KEY: secret,
        }),
        'event_submit',
        { fetchImpl },
      )

      expect(result).toBe(false)
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it('uses the official success secret only when local or test is explicit', async () => {
    const fetchImpl = vi.fn(async () => successfulVerification())
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({ APP_ENV: 'local' }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(true)
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body.secret).toBe(TEST_SECRET)
  })

  it.each([
    ['action', { action: 'event_edit', hostname: EXPECTED_HOSTNAME }],
    ['hostname', { action: 'event_submit', hostname: 'evil.miku-events.dev' }],
  ])('rejects a successful response with mismatched %s', async (_label, responseFields) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, ...responseFields }))
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({
        APP_ENV: 'production',
        CLOUDFLARE_TURNSTILE_SECRET_KEY: REAL_SECRET,
      }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(false)
  })

  it('requires a configured hostname to match in local environments', async () => {
    const fetchImpl = vi.fn(async () => successfulVerification('event_submit', 'other.example.test'))
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({
        APP_ENV: 'local',
        TURNSTILE_EXPECTED_HOSTNAME: EXPECTED_HOSTNAME,
      }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(false)
  })

  it('accepts a valid production response with matching action and hostname', async () => {
    const fetchImpl = vi.fn(async () => successfulVerification())
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({
        APP_ENV: 'production',
        CLOUDFLARE_TURNSTILE_SECRET_KEY: REAL_SECRET,
      }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(true)
  })

  it.each([
    ['HTTP error', async () => jsonResponse({ success: false }, 503)],
    ['invalid JSON', async () => new Response('not-json')],
    ['network error', async () => { throw new Error('upstream-private-details') }],
  ])('returns false for a Siteverify %s', async (_label, implementation) => {
    const fetchImpl = vi.fn(implementation)
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({ APP_ENV: 'test' }),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(false)
  })

  it('uses a five-second abort signal and treats aborts as verification failure', async () => {
    const timeoutSignal = vi.fn((milliseconds: number) => {
      expect(milliseconds).toBe(5_000)
      return AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'))
    })
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true)
      throw new DOMException('Timed out', 'TimeoutError')
    })
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({ APP_ENV: 'test' }),
      'event_submit',
      { fetchImpl, timeoutSignal },
    )

    expect(result).toBe(false)
    expect(timeoutSignal).toHaveBeenCalledOnce()
  })

  it.each([
    ['cf-connecting-ip', { 'cf-connecting-ip': '203.0.113.10' }, '203.0.113.10'],
    ['x-forwarded-for', { 'x-forwarded-for': '198.51.100.8, 10.0.0.1' }, '198.51.100.8'],
  ])('sends %s and a UUID idempotency key', async (_label, headers, expectedIp) => {
    const fetchImpl = vi.fn(async () => successfulVerification())
    vi.stubGlobal('fetch', fetchImpl)

    const result = await verifyTurnstileToken(
      'valid-token',
      requestWithEnvironment({ APP_ENV: 'test' }, headers),
      'event_submit',
      { fetchImpl },
    )

    expect(result).toBe(true)
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      remoteip: expectedIp,
      response: 'valid-token',
    })
    expect(body.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })
})

describe('event handlers bind Turnstile actions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function authenticatedRequest(body: Record<string, unknown>, query: Record<string, string> = {}) {
    const env: ApiEnvironment = {
      APP_ENV: 'test',
      SESSION_SECRET,
    }
    const headers = new Headers()
    setSessionCookie(headers, { id: 39, login: 'miku-contributor', ts: Date.now() }, env)
    const cookie = headers.get('set-cookie')?.split(';', 1)[0] ?? ''

    return createRequest({
      method: 'POST',
      body,
      env,
      query,
      headers: {
        cookie,
        'cf-connecting-ip': '203.0.113.15',
        'content-type': 'application/json',
      },
    })
  }

  it.each([
    ['submission', submissionModule, 'createSubmissionHandler', 'event_submit', {}],
    ['edit request', editRequestModule, 'createEditRequestHandler', 'event_edit', { eventId: 'test-event' }],
  ])('passes the exact %s action to its verifier', async (
    _label,
    handlerModule,
    factoryName,
    expectedAction,
    query,
  ) => {
    const factory = Reflect.get(handlerModule, factoryName)
    expect(factory).toBeTypeOf('function')
    if (typeof factory !== 'function') return

    const verifyToken = vi.fn(async () => false)
    const handler = asLegacyHandler(factory({ verifyTurnstileToken: verifyToken }))
    const response = createResponse()

    const body = expectedAction === 'event_submit'
      ? {
          attributionConsent: true,
          snsUrl: 'https://x.com/miku',
          startsOn: '2026-08-10',
          timezone: 'Asia/Seoul',
          title: 'Miku event',
          turnstileToken: 'valid-token',
          type: 'concert',
        }
      : {
          attributionConsent: true,
          message: 'Please update this event',
          turnstileToken: 'valid-token',
        }
    await handler(authenticatedRequest(body, query), response)

    expect(verifyToken).toHaveBeenCalledOnce()
    expect(verifyToken.mock.calls[0]?.[3]).toBe(expectedAction)
  })
})
