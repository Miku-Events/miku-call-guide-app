// @vitest-environment node

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import callbackHandler from '../../api/auth/github/callback.js'
import startHandler, { safeReturnTo } from '../../api/auth/github/start.js'
import sessionHandler from '../../api/auth/session.js'
import {
  readSession,
  setSessionCookie,
  signState,
  verifyState,
} from '../../api/_session.js'
import {
  createRequest,
  createResponse,
  getSetCookies,
  type ApiEnvironment,
} from './apiTestHarness'

const NOW = new Date('2026-07-10T00:00:00.000Z')
const STRONG_SECRET = 'miku-call-guide-test-secret-32-bytes-minimum'
const GLOBAL_SECRET = 'global-test-secret-that-is-also-long-enough'
const CODE_VERIFIER = 'v'.repeat(43)

const testEnv: ApiEnvironment = {
  APP_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  GITHUB_OAUTH_CLIENT_ID: 'request-client-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'request-client-secret',
  SESSION_SECRET: STRONG_SECRET,
}

const productionEnv: ApiEnvironment = {
  ...testEnv,
  APP_ENV: 'production',
  APP_ORIGIN: 'https://miku.example.test',
}

const originalEnvironment = {
  APP_ENV: process.env.APP_ENV,
  APP_ORIGIN: process.env.APP_ORIGIN,
  GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID,
  GITHUB_OAUTH_CLIENT_SECRET: process.env.GITHUB_OAUTH_CLIENT_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
}

function restoreEnvironment(): void {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function makeState(
  env: ApiEnvironment = testEnv,
  timestamp = NOW.getTime(),
): string {
  return signState({
    nonce: 'test-nonce',
    returnTo: '/events?view=month',
    ts: timestamp,
  }, env)
}

function makeTransactionCookie(
  state: string,
  env: ApiEnvironment = testEnv,
  timestamp = NOW.getTime(),
): string {
  const value = signState({
    state,
    codeVerifier: CODE_VERIFIER,
    ts: timestamp,
  }, env)
  const name = env.APP_ENV === 'production' || env.APP_ENV === 'preview'
    ? '__Host-miku_call_guide_oauth'
    : 'miku_call_guide_oauth'
  return `${name}=${value}`
}

function stubSuccessfulGitHub(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
    const url = String(input)
    if (url.includes('/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'github-access-token' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }
    if (url.endsWith('/user')) {
      return new Response(JSON.stringify({ id: 39, login: 'miku-user' }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      })
    }
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  process.env.APP_ENV = 'test'
  process.env.APP_ORIGIN = 'https://global.example.test'
  process.env.GITHUB_OAUTH_CLIENT_ID = 'global-client-id'
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'global-client-secret'
  process.env.SESSION_SECRET = GLOBAL_SECRET
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreEnvironment()
})

describe('signed state and sessions', () => {
  it('rejects invalid, expired, and future state values', () => {
    const valid = makeState()
    const [body, signature] = valid.split('.')

    expect(verifyState(`${body}.${signature}extra`, testEnv)).toBeNull()
    expect(verifyState(makeState(testEnv, NOW.getTime() - 600_001), testEnv)).toBeNull()
    expect(verifyState(makeState(testEnv, NOW.getTime() + 1), testEnv)).toBeNull()
  })

  it.each([
    'short',
    'replace-with-random-secret-that-is-long-enough',
    'YOUR_SESSION_SECRET_that_is_long_enough',
  ])('rejects unsafe SESSION_SECRET value %s', (sessionSecret) => {
    expect(() => signState({ ts: NOW.getTime() }, {
      ...testEnv,
      SESSION_SECRET: sessionSecret,
    })).toThrow('SESSION_SECRET')
  })

  it('requires an explicit supported APP_ENV before issuing cookies', () => {
    const response = createResponse()
    expect(() => setSessionCookie(response, {
      id: 39,
      login: 'miku-user',
      ts: NOW.getTime(),
    }, {
      SESSION_SECRET: STRONG_SECRET,
    })).toThrow('APP_ENV')
  })

  it('sets a secure seven-day production session cookie', () => {
    const response = createResponse()

    setSessionCookie(response, {
      id: 39,
      login: 'miku-user',
      ts: NOW.getTime(),
    }, productionEnv)

    expect(getSetCookies(response)).toEqual([
      expect.stringMatching(
        /^__Host-miku_call_guide_session=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/,
      ),
    ])
  })

  it('expires sessions after seven days and keeps the session endpoint compatible', () => {
    const eightDaysAgo = NOW.getTime() - (8 * 24 * 60 * 60 * 1000)
    const expiredValue = signState({
      id: 39,
      login: 'miku-user',
      ts: eightDaysAgo,
    }, testEnv)
    const request = createRequest({
      env: testEnv,
      headers: { cookie: `miku_call_guide_session=${expiredValue}` },
    })

    expect(readSession(request, testEnv)).toBeNull()

    const response = createResponse()
    sessionHandler(request, response)
    expect(response.statusCode).toBe(200)
    expect(response.body).toEqual({ authenticated: false, login: undefined })
  })
})

describe('OAuth start', () => {
  it('uses explicit request environment and binds a secure transaction cookie', () => {
    const request = createRequest({
      env: productionEnv,
      query: { returnTo: '/events?view=month' },
    })
    const response = createResponse()

    startHandler(request, response)

    expect(response.statusCode).toBe(302)
    const location = new URL(String(response.redirectUrl))
    expect(location.searchParams.get('client_id')).toBe('request-client-id')
    expect(location.searchParams.get('state')).toBeTruthy()
    expect(location.searchParams.has('scope')).toBe(false)
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    const cookies = getSetCookies(response)
    expect(cookies).toEqual([
      expect.stringMatching(
        /^__Host-miku_call_guide_oauth=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/,
      ),
    ])
    const signedTransaction = cookies[0].split(';', 1)[0].split('=', 2)[1]
    const transaction = JSON.parse(
      Buffer.from(signedTransaction.split('.', 1)[0], 'base64url').toString('utf8'),
    ) as { state: string; codeVerifier: string; ts: number }
    expect(transaction).toMatchObject({
      state: location.searchParams.get('state'),
      ts: NOW.getTime(),
    })
    expect(transaction.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(transaction.codeVerifier).digest('base64url'),
    )
  })

  it('uses the explicit environment when sanitizing return destinations', () => {
    expect(safeReturnTo('https://miku.example.test/events', productionEnv)).toBe('/events')
    expect(safeReturnTo('https://global.example.test/events', productionEnv)).toBe(
      'https://miku.example.test',
    )
  })
})

describe('OAuth callback', () => {
  it.each([
    ['missing', undefined],
    ['invalid', 'staging'],
  ])('clears both transaction cookie modes and returns a stable error when APP_ENV is %s', async (
    _label,
    appEnvironment,
  ) => {
    const fetchMock = stubSuccessfulGitHub()
    const environment: ApiEnvironment = {
      ...testEnv,
      APP_ENV: appEnvironment,
    }
    const state = makeState(environment)
    const transactionValue = makeTransactionCookie(state).split('=', 2)[1]
    const response = createResponse()

    await expect(callbackHandler(createRequest({
      env: environment,
      headers: {
        cookie: [
          `__Host-miku_call_guide_oauth=${transactionValue}`,
          `miku_call_guide_oauth=${transactionValue}`,
        ].join('; '),
      },
      query: { code: 'oauth-code', state },
    }), response)).resolves.toBeUndefined()

    expect(response.statusCode).toBe(503)
    expect(response.body).toEqual({
      error: 'github_oauth_not_configured',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(response.body)).not.toContain('APP_ENV')
    expect(getSetCookies(response)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^__Host-miku_call_guide_oauth=; .*Max-Age=0.*Secure/),
      expect.stringMatching(/^miku_call_guide_oauth=; .*Max-Age=0/),
    ]))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a matching transaction cookie', async () => {
    stubSuccessfulGitHub()
    const state = makeState()

    for (const cookie of [
      '',
      makeTransactionCookie(makeState(testEnv, NOW.getTime() - 1000)),
      makeTransactionCookie(state, testEnv, NOW.getTime() - 600_001),
    ]) {
      const response = createResponse()
      await callbackHandler(createRequest({
        env: testEnv,
        headers: cookie ? { cookie } : {},
        query: { code: 'oauth-code', state },
      }), response)

      expect(response.statusCode).toBe(400)
      expect(response.body).toEqual({
        error: 'invalid_oauth_callback',
        requestId: expect.any(String),
      })
      expect(getSetCookies(response)).toEqual([
        expect.stringContaining('miku_call_guide_oauth=;'),
      ])
    }
  })

  it('exchanges the original PKCE verifier and clears the transaction cookie on success', async () => {
    const fetchMock = stubSuccessfulGitHub()
    const state = makeState()
    const response = createResponse()

    await callbackHandler(createRequest({
      env: testEnv,
      headers: { cookie: makeTransactionCookie(state) },
      query: { code: 'oauth-code', state },
    }), response)

    expect(response.statusCode).toBe(302)
    expect(response.redirectUrl).toBe('/events?view=month')
    const oauthRequest = fetchMock.mock.calls.find(([input]) => (
      String(input).includes('/login/oauth/access_token')
    ))
    expect(oauthRequest).toBeDefined()
    const oauthBody = JSON.parse(String(oauthRequest?.[1]?.body)) as Record<string, unknown>
    expect(oauthBody).toMatchObject({
      client_id: 'request-client-id',
      code: 'oauth-code',
      code_verifier: CODE_VERIFIER,
    })

    const cookies = getSetCookies(response)
    expect(cookies).toHaveLength(2)
    expect(cookies).toEqual(expect.arrayContaining([
      expect.stringMatching(/^miku_call_guide_oauth=; .*Max-Age=0/),
      expect.stringMatching(/^miku_call_guide_session=.*Max-Age=604800/),
    ]))
  })

  it('returns a stable error and clears the transaction cookie when GitHub fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => (
      new Response('upstream-private-details', { status: 500 })
    )))
    const state = makeState()
    const response = createResponse()

    await callbackHandler(createRequest({
      env: testEnv,
      headers: { cookie: makeTransactionCookie(state) },
      query: { code: 'oauth-code', state },
    }), response)

    expect(response.statusCode).toBe(502)
    expect(response.body).toEqual({
      error: 'github_oauth_failed',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(response.body)).not.toContain('upstream-private-details')
    expect(getSetCookies(response)).toEqual([
      expect.stringMatching(/^miku_call_guide_oauth=; .*Max-Age=0/),
    ])
  })
})

describe('logout', () => {
  it('allows only POST and clears new, local, and legacy auth cookies', async () => {
    const logoutModule = import('../../api/auth/logout.js')
    await expect(logoutModule).resolves.toHaveProperty('default')
    const { default: logoutHandler } = await logoutModule

    const getResponse = createResponse()
    logoutHandler(createRequest({ env: productionEnv }), getResponse)
    expect(getResponse.statusCode).toBe(405)
    expect(getResponse.getHeader('allow')).toBe('POST')

    const postResponse = createResponse()
    logoutHandler(createRequest({
      env: productionEnv,
      method: 'POST',
    }), postResponse)
    expect(postResponse.statusCode).toBe(204)
    expect(getSetCookies(postResponse)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^__Host-miku_call_guide_session=; .*Max-Age=0.*Secure/),
      expect.stringMatching(/^miku_call_guide_session=; .*Max-Age=0/),
      expect.stringMatching(/^__Host-miku_call_guide_oauth=; .*Max-Age=0.*Secure/),
      expect.stringMatching(/^miku_call_guide_oauth=; .*Max-Age=0/),
    ]))
  })
})
