import { createPrivateKey, webcrypto } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const SECRET = 'readiness-session-secret-that-is-long-enough'
const APP_ORIGIN = 'https://miku-call-guide-app.pages.dev'
const READINESS_CONTRACT_HEADER = 'x-miku-readiness-contract'
const READINESS_CONTRACT_VERSION = 'runtime-config-v1'
let pkcs1PrivateKeyPem = ''
let pkcs8PrivateKeyPem = ''

function toPem(buffer: ArrayBuffer) {
  const base64 = Buffer.from(buffer).toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`
}

async function productionEnvironment(privateKey = pkcs8PrivateKeyPem) {
  return {
    APP_ENV: 'production',
    APP_ORIGIN,
    CLOUDFLARE_TURNSTILE_SECRET_KEY: '0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_INSTALLATION_ID: '987654',
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_DATA_OWNER: 'Miku-Events',
    GITHUB_DATA_REPO: 'miku-call-guide-data',
    GITHUB_OAUTH_CLIENT_ID: 'oauth-client-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'oauth-client-secret',
    SESSION_SECRET: SECRET,
    TURNSTILE_EXPECTED_HOSTNAME: 'miku-call-guide-app.pages.dev',
  }
}

async function requestReadiness(environment: Record<string, unknown>) {
  const modulePath = '../../functions/api/ready.js'
  const { onRequest } = await import(/* @vite-ignore */ modulePath)
  return onRequest({
    env: environment,
    params: {},
    request: new Request(`${APP_ORIGIN}/api/ready`),
  })
}

async function requestDirectReadiness(environment: Record<string, string>) {
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value)
  }

  const modulePath = '../../api/ready.js'
  const { default: handler } = await import(/* @vite-ignore */ modulePath)
  const headers = new Headers()
  let body: unknown
  let statusCode = 200
  const responseAdapter = {
    end() {
      return responseAdapter
    },
    json(value: unknown) {
      body = value
      headers.set('content-type', 'application/json')
      return responseAdapter
    },
    setHeader(name: string, value: string | string[]) {
      headers.delete(name)
      for (const item of Array.isArray(value) ? value : [value]) {
        headers.append(name, item)
      }
      return responseAdapter
    },
    status(value: number) {
      statusCode = value
      return responseAdapter
    },
  }

  await handler({
    headers: {},
    method: 'GET',
    url: `${APP_ORIGIN}/api/ready`,
  }, responseAdapter)

  return new Response(JSON.stringify(body), { headers, status: statusCode })
}

beforeAll(async () => {
  const keyPair = await webcrypto.subtle.generateKey({
    hash: 'SHA-256',
    modulusLength: 2048,
    name: 'RSASSA-PKCS1-v1_5',
    publicExponent: new Uint8Array([1, 0, 1]),
  }, true, ['sign', 'verify'])
  const privateKeyDer = await webcrypto.subtle.exportKey('pkcs8', keyPair.privateKey)
  pkcs8PrivateKeyPem = toPem(privateKeyDer)
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
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('production readiness endpoint', () => {
  it.each([
    ['PKCS#8 PRIVATE KEY', () => pkcs8PrivateKeyPem],
    ['GitHub App PKCS#1 RSA PRIVATE KEY', () => pkcs1PrivateKeyPem],
  ])('reports ready for a generated %s ending in a newline', async (_label, privateKey) => {
    const pem = privateKey()
    expect(pem).toMatch(/\n$/)

    const response = await requestReadiness(await productionEnvironment(pem))

    expect(response.status).toBe(200)
    expect(response.headers.get(READINESS_CONTRACT_HEADER)).toBe(READINESS_CONTRACT_VERSION)
    expect(await response.json()).toEqual({ ready: true })
  })

  it('returns only a sanitized JSON ready contract for complete production configuration', async () => {
    const response = await requestReadiness(await productionEnvironment())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(response.headers.get(READINESS_CONTRACT_HEADER)).toBe(READINESS_CONTRACT_VERSION)
    expect(await response.json()).toEqual({ ready: true })
  })

  it('reports ready without a rate-limit attestation when the remaining production configuration is complete', async () => {
    const environment = await productionEnvironment()
    expect('CLOUDFLARE_WRITE_RATE_LIMIT_CONFIGURED' in environment).toBe(false)

    const response = await requestReadiness(environment)

    expect(response.status).toBe(200)
    expect(response.headers.get(READINESS_CONTRACT_HEADER)).toBe(READINESS_CONTRACT_VERSION)
    expect(await response.json()).toEqual({ ready: true })
  })

  it('rejects a different canonical APP_ORIGIN even when its Turnstile hostname matches', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await requestReadiness({
      ...await productionEnvironment(),
      APP_ORIGIN: 'https://alternate-miku-call-guide-app.pages.dev',
      TURNSTILE_EXPECTED_HOSTNAME: 'alternate-miku-call-guide-app.pages.dev',
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'service_not_ready',
      requestId: expect.any(String),
    })
    consoleError.mockRestore()
  })

  it.each([
    'https://miku-call-guide-app.pages.dev/',
    'https://MIKU-CALL-GUIDE-APP.PAGES.DEV',
    'https://miku-call-guide-app.pages.dev:443',
    ' https://miku-call-guide-app.pages.dev',
    'https://miku-call-guide-app.pages.dev ',
  ])('rejects non-canonical production APP_ORIGIN %s without leaking it', async (appOrigin) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await requestReadiness({
      ...await productionEnvironment(),
      APP_ORIGIN: appOrigin,
    })
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      error: 'service_not_ready',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain(appOrigin)
    consoleError.mockRestore()
  })

  it('uses process.env in the direct API runtime', async () => {
    const environment = await productionEnvironment()
    const response = await requestDirectReadiness(
      Object.fromEntries(Object.entries(environment).map(([name, value]) => [name, String(value)])),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(READINESS_CONTRACT_HEADER)).toBe(READINESS_CONTRACT_VERSION)
    expect(await response.json()).toEqual({ ready: true })
  })

  it('accepts a case-normalized Turnstile hostname like the verifier does', async () => {
    const response = await requestReadiness({
      ...await productionEnvironment(),
      TURNSTILE_EXPECTED_HOSTNAME: 'MIKU-CALL-GUIDE-APP.PAGES.DEV',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ready: true })
  })

  it.each([
    '192.0.2.1',
    'example.com',
    'your-app.invalid',
    'placeholder.miku-events.dev',
  ])('cannot report ready for hostname rejected by the Turnstile verifier: %s', async (hostname) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const appOrigin = `https://${hostname}`
    const response = await requestReadiness({
      ...await productionEnvironment(),
      APP_ORIGIN: appOrigin,
      TURNSTILE_EXPECTED_HOSTNAME: hostname,
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'service_not_ready',
      requestId: expect.any(String),
    })
  })

  it.each([
    'APP_ORIGIN',
    'CLOUDFLARE_TURNSTILE_SECRET_KEY',
    'GITHUB_APP_ID',
    'GITHUB_APP_INSTALLATION_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_DATA_OWNER',
    'GITHUB_DATA_REPO',
    'GITHUB_OAUTH_CLIENT_ID',
    'GITHUB_OAUTH_CLIENT_SECRET',
    'SESSION_SECRET',
    'TURNSTILE_EXPECTED_HOSTNAME',
  ])('returns a standard non-leaking 503 when %s is missing', async (name) => {
    const environment = await productionEnvironment()
    delete environment[name as keyof typeof environment]
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await requestReadiness(environment)
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      error: 'service_not_ready',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain(name)
    expect(JSON.stringify(body)).not.toContain(SECRET)
    consoleError.mockRestore()
  })

  it.each([
    ['a non-production APP_ENV', { APP_ENV: 'preview' }],
    ['a non-origin APP_ORIGIN', { APP_ORIGIN: 'https://miku-call-guide-app.pages.dev/path' }],
    ['an origin/Turnstile hostname mismatch', { TURNSTILE_EXPECTED_HOSTNAME: 'other.miku-events.dev' }],
    ['an invalid private key', { GITHUB_APP_PRIVATE_KEY: 'not-a-private-key' }],
  ])('fails closed for %s', async (_label, override) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await requestReadiness({
      ...await productionEnvironment(),
      ...override,
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'service_not_ready',
      requestId: expect.any(String),
    })
    consoleError.mockRestore()
  })

  it.each([
    ['a placeholder key', 'replace-with-github-app-private-key'],
    [
      'an encrypted private key',
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\nQUJDRA==\n-----END ENCRYPTED PRIVATE KEY-----\n',
    ],
    [
      'an unsupported EC private key',
      '-----BEGIN EC PRIVATE KEY-----\nQUJDRA==\n-----END EC PRIVATE KEY-----\n',
    ],
    [
      'malformed base64',
      '-----BEGIN PRIVATE KEY-----\nnot!base64\n-----END PRIVATE KEY-----\n',
    ],
  ])('rejects %s without exposing key material', async (_label, privateKey) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await requestReadiness(await productionEnvironment(privateKey))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      error: 'service_not_ready',
      requestId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain(privateKey)
    consoleError.mockRestore()
  })
})
