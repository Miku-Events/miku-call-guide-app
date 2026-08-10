// @vitest-environment node

import { createPrivateKey, webcrypto } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createEventPullRequest,
  createEditRequestIssue,
  exchangeOAuthCode,
  fetchGitHubUser,
  installationToken,
  resetGitHubStateForTests,
  repoConfig,
} from '../../functions/_lib/github.js'

const oauthEnvironment = {
  GITHUB_OAUTH_CLIENT_ID: 'request-client-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'request-client-secret',
}
const oauthRedirectUri = 'https://app.miku-events.dev/api/auth/github/callback'

let pkcs1PrivateKeyPem = ''
let pkcs8PrivateKeyPem = ''

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

beforeAll(async () => {
  const keyPair = await webcrypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  )
  const privateKeyDer = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  const exported = Buffer.from(privateKeyDer)
    .toString('base64')
    .match(/.{1,64}/g)
    ?.join('\n')
  pkcs8PrivateKeyPem = `-----BEGIN PRIVATE KEY-----\n${exported}\n-----END PRIVATE KEY-----\n`
  pkcs1PrivateKeyPem = createPrivateKey({
    format: 'der',
    key: Buffer.from(privateKeyDer),
    type: 'pkcs8',
  }).export({
    format: 'pem',
    type: 'pkcs1',
  }).toString()
})

function githubAppEnvironment() {
  return {
    GITHUB_APP_ID: 'request-app-id',
    GITHUB_APP_INSTALLATION_ID: 'request-installation-id',
    GITHUB_APP_PRIVATE_KEY: pkcs8PrivateKeyPem,
    GITHUB_DATA_OWNER: 'request-owner',
    GITHUB_DATA_REPO: 'request-repo',
  }
}

function installationTokenResponse(token = 'installation-token') {
  return responseJson({
    expires_at: '2099-01-01T00:00:00Z',
    token,
  }, 201)
}

const eventPullRequestInput = {
  branchName: `submissions/events/miku-event-${'a'.repeat(24)}`,
  content: 'schemaVersion: 1\n',
  eventId: 'miku-event',
  filePath: 'events/2026/08/miku-event.yaml',
  fingerprint: 'a'.repeat(64),
  idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
  submitter: 'miku-user',
  title: 'Miku event',
}

describe('GitHub writer idempotency and rollback', () => {
  it('caches installation tokens until sixty seconds before expiration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(installationTokenResponse())
    vi.stubGlobal('fetch', fetchMock)
    const environment = githubAppEnvironment()

    await expect(installationToken(environment)).resolves.toBe('installation-token')
    await expect(installationToken(environment)).resolves.toBe('installation-token')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('refreshes a cached token once it enters the sixty-second expiry window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-10T00:00:00Z'))
    const firstExpiry = new Date(Date.now() + 61_000).toISOString()
    const secondExpiry = new Date(Date.now() + 3_600_000).toISOString()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseJson({ expires_at: firstExpiry, token: 'first-token' }, 201))
      .mockResolvedValueOnce(responseJson({ expires_at: secondExpiry, token: 'second-token' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const environment = githubAppEnvironment()

    await expect(installationToken(environment)).resolves.toBe('first-token')
    await vi.advanceTimersByTimeAsync(1_001)
    await expect(installationToken(environment)).resolves.toBe('second-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses a fixed commit subject and creates one deterministic event PR', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockResolvedValueOnce(responseJson({ html_url: 'https://github.example/pull/7' }, 201))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).resolves.toMatchObject({
      html_url: 'https://github.example/pull/7',
      replayed: false,
    })

    const fileWrite = fetchMock.mock.calls.find(([input, options]) => (
      String(input).includes('/contents/events/2026/08/miku-event.yaml')
      && options?.method === 'PUT'
    ))
    const fileBody = JSON.parse(String(fileWrite?.[1]?.body))
    expect(fileBody.message).toBe('Add event submission: miku-event')
    expect(fileBody.message).not.toContain(eventPullRequestInput.title)

    const pullWrite = fetchMock.mock.calls.find(([input, options]) => (
      String(input).endsWith('/pulls') && options?.method === 'POST'
    ))
    const pullBody = JSON.parse(String(pullWrite?.[1]?.body))
    expect(pullBody).toMatchObject({
      head: eventPullRequestInput.branchName,
      title: 'Add event: Miku event',
    })
  })

  it('returns submission_conflict before creating a branch when the base file exists', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({ sha: 'existing-file' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({ code: 'submission_conflict', status: 409 })
    expect(fetchMock.mock.calls.some(([, options]) => (
      options?.method === 'PUT' || options?.method === 'DELETE'
    ))).toBe(false)
  })

  it('replays an existing PR for the deterministic branch without mutating GitHub', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'branch-sha' } }))
      .mockResolvedValueOnce(responseJson([{ html_url: 'https://github.example/pull/8' }]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).resolves.toMatchObject({
      html_url: 'https://github.example/pull/8',
      replayed: true,
    })
    expect(fetchMock.mock.calls.some(([, options]) => (
      options?.method === 'PUT' || options?.method === 'DELETE'
    ))).toBe(false)
  })

  it('never deletes a pre-existing branch while another identical request may be in progress', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'branch-sha' } }))
      .mockResolvedValueOnce(responseJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({ code: 'submission_in_progress', status: 409 })
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('reconciles a branch-create race without retrying or deleting the competing ref', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(responseJson({ message: 'Reference already exists' }, 422))
      .mockResolvedValueOnce(responseJson([]))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'competing-sha' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({ code: 'submission_in_progress', status: 409 })
    const refCreates = fetchMock.mock.calls.filter(([input, options]) => (
      String(input).endsWith('/git/refs') && options?.method === 'POST'
    ))
    expect(refCreates).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('deletes its confirmed branch when file creation fails and no PR exists', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockResolvedValueOnce(responseJson({ message: 'private failure' }, 500))
      .mockResolvedValueOnce(responseJson([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({
      code: 'github_upstream_failed',
      logMetadata: { replay: false, rollback: true },
    })
    expect(fetchMock.mock.calls.some(([input, options]) => (
      String(input).includes('/git/refs/heads/') && options?.method === 'DELETE'
    ))).toBe(true)
  })

  it('deletes its confirmed branch after a definitive PR creation failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockResolvedValueOnce(responseJson({ message: 'PR rejected' }, 422))
      .mockResolvedValueOnce(responseJson([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({
      code: 'github_upstream_failed',
      logMetadata: { replay: false, rollback: true },
    })
    expect(fetchMock.mock.calls.some(([input, options]) => (
      String(input).includes('/git/refs/heads/') && options?.method === 'DELETE'
    ))).toBe(true)
  })

  it('reports rollback false when cleanup of a confirmed branch fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockResolvedValueOnce(responseJson({ message: 'file rejected' }, 500))
      .mockResolvedValueOnce(responseJson([]))
      .mockResolvedValueOnce(responseJson({ message: 'ref cleanup failed' }, 500))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({
      code: 'github_upstream_failed',
      logMetadata: { replay: false, rollback: false },
    })
    expect(fetchMock.mock.calls.some(([input, options]) => (
      String(input).includes('/git/refs/heads/') && options?.method === 'DELETE'
    ))).toBe(true)
  })

  it('reconciles an uncertain PR response before considering rollback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockRejectedValueOnce(new Error('connection reset after write'))
      .mockResolvedValueOnce(responseJson([{ html_url: 'https://github.example/pull/9' }]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).resolves.toMatchObject({
      html_url: 'https://github.example/pull/9',
      replayed: true,
    })
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('preserves a confirmed branch when PR reconciliation also fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockResolvedValueOnce(responseJson({}, 201))
      .mockRejectedValueOnce(new Error('connection reset after PR creation'))
      .mockRejectedValueOnce(new Error('PR reconciliation unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({
      logMetadata: { replay: false, rollback: false },
    })
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('refreshes an installation token once on 401 and does not retry other statuses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse('first-token'))
      .mockResolvedValueOnce(responseJson({}, 401))
      .mockResolvedValueOnce(installationTokenResponse('second-token'))
      .mockResolvedValueOnce(responseJson({ sha: 'existing-file' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({ code: 'submission_conflict' })
    const tokenCalls = fetchMock.mock.calls.filter(([input]) => (
      String(input).includes('/access_tokens')
    ))
    const contentCalls = fetchMock.mock.calls.filter(([input]) => (
      String(input).includes('/contents/events/2026/08/miku-event.yaml')
    ))
    expect(tokenCalls).toHaveLength(2)
    expect(contentCalls).toHaveLength(2)
  })

  it('does not retry a mutation after a 401 response crosses the quota floor', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 3600)
    const unauthorizedLowRate = new Response('{}', {
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': reset,
      },
      status: 401,
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse('first-token'))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(unauthorizedLowRate)
      .mockResolvedValueOnce(installationTokenResponse('second-token'))
      .mockResolvedValueOnce(responseJson([]))
      .mockResolvedValueOnce(responseJson({}, 404))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({
      code: 'github_write_rate_limited',
      logMetadata: { replay: false, rollback: false },
    })
    const tokenCalls = fetchMock.mock.calls.filter(([input]) => (
      String(input).includes('/access_tokens')
    ))
    const refCreates = fetchMock.mock.calls.filter(([input, options]) => (
      String(input).endsWith('/git/refs') && options?.method === 'POST'
    ))
    expect(tokenCalls).toHaveLength(2)
    expect(refCreates).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('fails closed before a repository mutation when GitHub reports fewer than 100 requests', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 3600)
    const lowRateResponse = new Response('{}', {
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': reset,
      },
      status: 404,
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(lowRateResponse)
      .mockResolvedValueOnce(responseJson({}, 404))
      .mockResolvedValueOnce(responseJson({ object: { sha: 'base-sha' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({ code: 'github_write_rate_limited', status: 503 })
    expect(fetchMock.mock.calls.some(([input, options]) => (
      String(input).endsWith('/git/refs') && options?.method === 'POST'
    ))).toBe(false)
  })

  it.each([
    ['branch creation', 4],
    ['file creation', 5],
  ])('stops after a low quota response from %s and rolls back its branch', async (_stage, lowRateIndex) => {
    const reset = String(Math.floor(Date.now() / 1000) + 3600)
    const normalResponses = [
      installationTokenResponse(),
      responseJson({}, 404),
      responseJson({}, 404),
      responseJson({ object: { sha: 'base-sha' } }),
      responseJson({}, 201),
      responseJson({}, 201),
    ]
    const original = normalResponses[lowRateIndex]
    normalResponses[lowRateIndex] = new Response(await original.text(), {
      headers: {
        'content-type': 'application/json',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': reset,
      },
      status: original.status,
    })
    const fetchMock = vi.fn()
    for (const response of normalResponses.slice(0, lowRateIndex + 1)) {
      fetchMock.mockResolvedValueOnce(response)
    }
    fetchMock
      .mockResolvedValueOnce(responseJson([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEventPullRequest(
      eventPullRequestInput,
      githubAppEnvironment(),
    )).rejects.toMatchObject({
      code: 'github_write_rate_limited',
      logMetadata: { replay: false, rollback: true },
    })
    const fileWrites = fetchMock.mock.calls.filter(([input, options]) => (
      String(input).includes('/contents/events/2026/08/miku-event.yaml')
      && options?.method === 'PUT'
    ))
    const pullWrites = fetchMock.mock.calls.filter(([input, options]) => (
      String(input).endsWith('/pulls') && options?.method === 'POST'
    ))
    expect(fileWrites).toHaveLength(lowRateIndex === 4 ? 0 : 1)
    expect(pullWrites).toHaveLength(0)
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(true)
  })

  it('renders every edit-message line as code and recovers duplicate Issue creation', async () => {
    const fingerprint = 'b'.repeat(64)
    const issueUrl = 'https://github.example/issues/7'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(installationTokenResponse())
      .mockResolvedValueOnce(responseJson([]))
      .mockRejectedValueOnce(new Error('connection reset after issue creation'))
      .mockResolvedValueOnce(responseJson([{
        body: `body\n<!-- miku-edit-request-fingerprint:${fingerprint} -->`,
        html_url: issueUrl,
      }]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEditRequestIssue({
      eventId: 'miku-event',
      fingerprint,
      message: '@maintainer\n### injected heading\n```',
      submitter: 'miku-user',
    }, githubAppEnvironment())).resolves.toMatchObject({
      html_url: issueUrl,
      replayed: true,
    })

    const issueWrite = fetchMock.mock.calls.find(([input, options]) => (
      String(input).endsWith('/issues') && options?.method === 'POST'
    ))
    const issueBody = JSON.parse(String(issueWrite?.[1]?.body)).body
    expect(issueBody).toContain('    @maintainer\n    ### injected heading\n    ```')
    expect(issueBody).toContain(`<!-- miku-edit-request-fingerprint:${fingerprint} -->`)
  })
})

afterEach(() => {
  resetGitHubStateForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GitHub upstream security', () => {
  it.each([
    ['PKCS#8 PRIVATE KEY', () => pkcs8PrivateKeyPem],
    ['GitHub App PKCS#1 RSA PRIVATE KEY', () => pkcs1PrivateKeyPem],
  ])('creates an installation token JWT with a generated %s ending in a newline', async (
    _label,
    privateKey,
  ) => {
    const fetchMock = vi.fn().mockResolvedValue(responseJson({ token: 'installation-token' }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const pem = privateKey()

    expect(pem).toMatch(/\n$/)

    await expect(installationToken({
      GITHUB_APP_ID: '123456',
      GITHUB_APP_INSTALLATION_ID: '987654',
      GITHUB_APP_PRIVATE_KEY: pem,
    })).resolves.toBe('installation-token')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/app/installations/987654/access_tokens',
    )
    const authorization = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')
    expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/)
  })

  it('classifies missing OAuth configuration as a sanitized 503 without a network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeOAuthCode(
      'oauth-code',
      'pkce-verifier',
      oauthRedirectUri,
      {},
    )).rejects.toMatchObject({
      code: 'github_oauth_not_configured',
      message: 'github_oauth_not_configured',
      status: 503,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the request-origin callback URI to the OAuth token exchange', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseJson({ access_token: 'access-token' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeOAuthCode(
      'oauth-code',
      'pkce-verifier',
      oauthRedirectUri,
      oauthEnvironment,
    )).resolves.toBe('access-token')

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ redirect_uri: oauthRedirectUri })
  })

  it.each([
    undefined,
    'https://other.example.dev/callback',
    'https://app.miku-events.dev/api/auth/github/callback?unexpected=1',
  ])('rejects invalid OAuth callback URI %s before a network call', async (redirectUri) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(exchangeOAuthCode(
      'oauth-code',
      'pkce-verifier',
      redirectUri,
      oauthEnvironment,
    )).rejects.toMatchObject({
      code: 'github_oauth_not_configured',
      status: 503,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('classifies invalid GitHub App credentials as a sanitized 503 without a network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEditRequestIssue({
      eventId: 'sample-event',
      message: 'Please fix the date',
      submitter: 'miku-user',
    }, {
      GITHUB_APP_ID: 'request-app-id',
      GITHUB_APP_INSTALLATION_ID: 'request-installation-id',
      GITHUB_APP_PRIVATE_KEY: 'not-a-private-key',
      GITHUB_DATA_OWNER: 'request-owner',
      GITHUB_DATA_REPO: 'request-repo',
    })).rejects.toMatchObject({
      code: 'github_app_not_configured',
      message: 'github_app_not_configured',
      status: 503,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts OAuth requests after 10 seconds and returns a sanitized 503 error', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('raw timeout details must not escape', 'AbortError'))
        }, { once: true })
      })
    ))
    vi.stubGlobal('fetch', fetchMock)

    const pending = exchangeOAuthCode(
      'oauth-code',
      'pkce-verifier',
      oauthRedirectUri,
      oauthEnvironment,
    )
      .catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetchMock).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)

    const error = await pending
    expect(error).toMatchObject({
      code: 'github_upstream_unavailable',
      message: 'github_upstream_unavailable',
      status: 503,
    })
    expect(JSON.stringify(error)).not.toContain('raw timeout details')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps the 10 second timeout active while a successful response body hangs', async () => {
    vi.useFakeTimers()
    const hangingBody = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(hangingBody, { status: 200 })))
    let outcome: unknown = 'pending'

    void exchangeOAuthCode('oauth-code', 'pkce-verifier', oauthRedirectUri, oauthEnvironment)
      .then(
        (value) => { outcome = value },
        (error: unknown) => { outcome = error },
      )
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.resolve()

    expect(outcome).toMatchObject({
      code: 'github_upstream_unavailable',
      message: 'github_upstream_unavailable',
      status: 503,
    })
  })

  it.each([
    ['non-OK', () => responseJson({ error: 'raw secret response' }, 401)],
    ['malformed JSON', () => new Response('{not-json', { status: 200 })],
    ['missing token', () => responseJson({ scope: 'read:user' })],
  ])('maps %s OAuth responses to a sanitized 502 error', async (_label, responseFactory) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseFactory()))

    const result = exchangeOAuthCode(
      'oauth-code',
      'pkce-verifier',
      oauthRedirectUri,
      oauthEnvironment,
    )

    await expect(result).rejects.toMatchObject({
      code: 'github_upstream_failed',
      message: 'github_upstream_failed',
      status: 502,
    })
    await expect(result).rejects.not.toThrow('raw secret response')
  })

  it.each([
    [
      'OAuth exchange',
      () => exchangeOAuthCode(
        'oauth-code',
        'pkce-verifier',
        oauthRedirectUri,
        oauthEnvironment,
      ),
    ],
    [
      'GitHub API',
      () => fetchGitHubUser('access-token', oauthEnvironment),
    ],
  ])('cancels a non-OK %s response body before returning 502', async (
    _label,
    invoke,
  ) => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull: () => new Promise<void>(() => undefined),
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 401 })))

    await expect(invoke()).rejects.toMatchObject({
      code: 'github_upstream_failed',
      status: 502,
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('maps malformed GitHub user payloads to a sanitized 502 error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseJson({ id: 39 })))

    await expect(fetchGitHubUser('access-token', oauthEnvironment)).rejects.toMatchObject({
      code: 'github_upstream_failed',
      status: 502,
    })
  })

  it('uses only the explicit request environment for repository configuration', () => {
    const originalOwner = process.env.GITHUB_DATA_OWNER
    const originalRepo = process.env.GITHUB_DATA_REPO
    process.env.GITHUB_DATA_OWNER = 'global-owner'
    process.env.GITHUB_DATA_REPO = 'global-repo'

    try {
      expect(repoConfig({
        GITHUB_DATA_BASE_BRANCH: 'release',
        GITHUB_DATA_OWNER: 'request-owner',
        GITHUB_DATA_REPO: 'request-repo',
      })).toEqual({
        baseBranch: 'release',
        owner: 'request-owner',
        repo: 'request-repo',
      })
    } finally {
      if (originalOwner === undefined) delete process.env.GITHUB_DATA_OWNER
      else process.env.GITHUB_DATA_OWNER = originalOwner
      if (originalRepo === undefined) delete process.env.GITHUB_DATA_REPO
      else process.env.GITHUB_DATA_REPO = originalRepo
    }
  })

  it('threads the explicit environment through writes, reconciles, and never retries a mutation', async () => {
    const environment = {
      GITHUB_APP_ID: 'request-app-id',
      GITHUB_APP_INSTALLATION_ID: 'request-installation-id',
      GITHUB_APP_PRIVATE_KEY: pkcs8PrivateKeyPem,
      GITHUB_DATA_OWNER: 'request-owner',
      GITHUB_DATA_REPO: 'request-repo',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseJson({
        expires_at: '2099-01-01T00:00:00Z',
        token: 'installation-token',
      }, 201))
      .mockResolvedValueOnce(responseJson([]))
      .mockResolvedValueOnce(responseJson({ message: 'raw mutation failure' }, 502))
      .mockResolvedValueOnce(responseJson([]))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEditRequestIssue({
      eventId: 'sample-event',
      fingerprint: 'a'.repeat(64),
      message: 'Please fix the date',
      submitter: 'miku-user',
    }, environment)).rejects.toMatchObject({
      code: 'github_upstream_failed',
      status: 502,
    })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/app/installations/request-installation-id/access_tokens',
    )
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      '/repos/request-owner/request-repo/issues',
    )
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2)
  })

  it('preserves successful issue URLs', async () => {
    const environment = {
      GITHUB_APP_ID: 'request-app-id',
      GITHUB_APP_INSTALLATION_ID: 'request-installation-id',
      GITHUB_APP_PRIVATE_KEY: pkcs8PrivateKeyPem,
      GITHUB_DATA_OWNER: 'request-owner',
      GITHUB_DATA_REPO: 'request-repo',
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(responseJson({
        expires_at: '2099-01-01T00:00:00Z',
        token: 'installation-token',
      }, 201))
      .mockResolvedValueOnce(responseJson([]))
      .mockResolvedValueOnce(responseJson({ html_url: 'https://github.com/request-owner/request-repo/issues/7' }, 201)))

    await expect(createEditRequestIssue({
      eventId: 'sample-event',
      fingerprint: 'b'.repeat(64),
      message: 'Please fix the date',
      submitter: 'miku-user',
    }, environment)).resolves.toMatchObject({
      html_url: 'https://github.com/request-owner/request-repo/issues/7',
    })
  })
})
