import { createPrivateKey, webcrypto } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cachedProductionReadiness,
  resetReadinessCacheForTests,
} from '../../functions/api/ready.js'

const SECRET = 'readiness-session-secret-that-is-long-enough'
const REQUEST_ORIGIN = 'https://miku-call-guide-app.pages.dev'
const READINESS_CONTRACT_HEADER = 'x-miku-readiness-contract'
const READINESS_CONTRACT_VERSION = 'runtime-config-v2'
let pkcs1PrivateKeyPem = ''
let pkcs8PrivateKeyPem = ''

function toPem(buffer: ArrayBuffer) {
  const base64 = Buffer.from(buffer).toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`
}

async function productionEnvironment(privateKey = pkcs8PrivateKeyPem) {
  return {
    APP_ENV: 'production',
    APP_ORIGIN: 'https://miku.sekai.today',
    CLOUDFLARE_TURNSTILE_SECRET_KEY: '0x4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_INSTALLATION_ID: '987654',
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_DATA_OWNER: 'Miku-Events',
    GITHUB_DATA_REPO: 'miku-call-guide-data',
    GITHUB_OAUTH_CLIENT_ID: 'oauth-client-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'oauth-client-secret',
    SESSION_SECRET: SECRET,
    SUBMISSION_WRITES_ENABLED: 'true',
  }
}

async function requestReadiness(
  environment: Record<string, unknown>,
  origin = REQUEST_ORIGIN,
) {
  const modulePath = '../../functions/api/ready.js'
  const { onRequest } = await import(/* @vite-ignore */ modulePath)
  return onRequest({
    env: environment,
    params: {},
    request: new Request(`${origin}/api/ready`),
  })
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
  resetReadinessCacheForTests()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
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

  it('caches success for 60 seconds and failure for 5 seconds by configuration identity', async () => {
    const environment = await productionEnvironment()
    const validateSuccess = vi.fn(async () => undefined)
    expect(await cachedProductionReadiness(environment, {
      now: 0,
      validate: validateSuccess,
    })).toBe(true)
    expect(await cachedProductionReadiness({ ...environment }, {
      now: 59_999,
      validate: validateSuccess,
    })).toBe(true)
    expect(validateSuccess).toHaveBeenCalledOnce()
    expect(await cachedProductionReadiness({ ...environment }, {
      now: 60_000,
      validate: validateSuccess,
    })).toBe(true)
    expect(validateSuccess).toHaveBeenCalledTimes(2)

    resetReadinessCacheForTests()
    const validateFailure = vi.fn(async () => { throw new Error('not ready') })
    expect(await cachedProductionReadiness(environment, {
      now: 0,
      validate: validateFailure,
    })).toBe(false)
    expect(await cachedProductionReadiness({ ...environment }, {
      now: 4_999,
      validate: validateFailure,
    })).toBe(false)
    expect(validateFailure).toHaveBeenCalledOnce()
    expect(await cachedProductionReadiness({ ...environment }, {
      now: 5_000,
      validate: validateFailure,
    })).toBe(false)
    expect(validateFailure).toHaveBeenCalledTimes(2)
  })

  it.each([
    'https://miku-call-guide-app.pages.dev',
    'https://miku.sekai.today',
    'https://next-custom-domain.example',
  ])('is independent of the deployment request origin %s', async (origin) => {
    const response = await requestReadiness(await productionEnvironment(), origin)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ready: true })
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
    'SUBMISSION_WRITES_ENABLED',
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
