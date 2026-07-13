// @vitest-environment node

import { createPrivateKey, webcrypto } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createEditRequestIssue,
  exchangeOAuthCode,
  fetchGitHubUser,
  installationToken,
  repoConfig,
} from '../../api/_github.js'

const oauthEnvironment = {
  GITHUB_OAUTH_CLIENT_ID: 'request-client-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'request-client-secret',
}

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

afterEach(() => {
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

    await expect(exchangeOAuthCode('oauth-code', 'pkce-verifier', {})).rejects.toMatchObject({
      code: 'github_oauth_not_configured',
      message: 'github_oauth_not_configured',
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

    const pending = exchangeOAuthCode('oauth-code', 'pkce-verifier', oauthEnvironment)
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

    void exchangeOAuthCode('oauth-code', 'pkce-verifier', oauthEnvironment)
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

    const result = exchangeOAuthCode('oauth-code', 'pkce-verifier', oauthEnvironment)

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
      () => exchangeOAuthCode('oauth-code', 'pkce-verifier', oauthEnvironment),
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

  it('threads the explicit environment through GitHub App writes and never retries mutations', async () => {
    const environment = {
      GITHUB_APP_ID: 'request-app-id',
      GITHUB_APP_INSTALLATION_ID: 'request-installation-id',
      GITHUB_APP_PRIVATE_KEY: pkcs8PrivateKeyPem,
      GITHUB_DATA_OWNER: 'request-owner',
      GITHUB_DATA_REPO: 'request-repo',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(responseJson({ token: 'installation-token' }, 201))
      .mockResolvedValueOnce(responseJson({ message: 'raw mutation failure' }, 502))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createEditRequestIssue({
      eventId: 'sample-event',
      message: 'Please fix the date',
      submitter: 'miku-user',
    }, environment)).rejects.toMatchObject({
      code: 'github_upstream_failed',
      status: 502,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/app/installations/request-installation-id/access_tokens',
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/repos/request-owner/request-repo/issues',
    )
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
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
      .mockResolvedValueOnce(responseJson({ token: 'installation-token' }, 201))
      .mockResolvedValueOnce(responseJson({ html_url: 'https://github.com/request-owner/request-repo/issues/7' }, 201)))

    await expect(createEditRequestIssue({
      eventId: 'sample-event',
      message: 'Please fix the date',
      submitter: 'miku-user',
    }, environment)).resolves.toMatchObject({
      html_url: 'https://github.com/request-owner/request-repo/issues/7',
    })
  })
})
