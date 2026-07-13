import { randomUUID } from 'node:crypto'
import { canonicalSecureHostname } from './_production-hostname.js'
import { requestEnvironment } from './_session.js'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const DEFAULT_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA'
const SITEVERIFY_TIMEOUT_MS = 5_000
const MAX_TOKEN_LENGTH = 2_048

const validAppEnvironments = new Set(['local', 'test', 'preview', 'production'])
const secureAppEnvironments = new Set(['preview', 'production'])
const validActions = new Set(['event_submit', 'event_edit'])
const officialTestSecretKeys = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
])

function isPlaceholderSecret(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'changeme'
    || normalized === 'change-me'
    || normalized === 'secret'
    || normalized.includes('placeholder')
    || normalized.startsWith('replace-with-')
    || normalized.startsWith('replace_with_')
    || normalized.startsWith('your-')
    || normalized.startsWith('your_')
}

function turnstileConfiguration(req) {
  const environment = requestEnvironment(req)
  const appEnvironment = environment.APP_ENV
  if (!validAppEnvironments.has(appEnvironment)) {
    return null
  }

  const secure = secureAppEnvironments.has(appEnvironment)
  const configuredSecret = typeof environment.CLOUDFLARE_TURNSTILE_SECRET_KEY === 'string'
    ? environment.CLOUDFLARE_TURNSTILE_SECRET_KEY.trim()
    : ''
  const secretKey = configuredSecret || (secure ? '' : DEFAULT_TEST_SECRET_KEY)
  const configuredHostname = typeof environment.TURNSTILE_EXPECTED_HOSTNAME === 'string'
    ? environment.TURNSTILE_EXPECTED_HOSTNAME.trim()
    : ''
  const expectedHostname = secure
    ? canonicalSecureHostname(environment.TURNSTILE_EXPECTED_HOSTNAME)
    : configuredHostname

  if (!secretKey || isPlaceholderSecret(secretKey)) {
    return null
  }
  if (secure && (officialTestSecretKeys.has(secretKey) || !expectedHostname)) {
    return null
  }

  return { expectedHostname, secretKey }
}

function requestHeader(req, name) {
  const headers = req?.headers
  if (!headers) return ''

  if (typeof headers.get === 'function') {
    return headers.get(name) || ''
  }

  const exact = headers[name]
  if (Array.isArray(exact)) return exact[0] || ''
  if (exact !== undefined) return String(exact)

  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name)
  const value = matchingKey ? headers[matchingKey] : ''
  return Array.isArray(value) ? value[0] || '' : String(value || '')
}

function requestIp(req) {
  const cloudflareIp = requestHeader(req, 'cf-connecting-ip').trim()
  if (cloudflareIp) return cloudflareIp

  const forwardedIp = requestHeader(req, 'x-forwarded-for').split(',')[0].trim()
  if (forwardedIp) return forwardedIp

  return req?.socket?.remoteAddress || ''
}

/**
 * Validate a Turnstile token against a request-scoped environment.
 * @param {unknown} token
 * @param {import('node:http').IncomingMessage & { env?: Record<string, string | undefined> }} req
 * @param {'event_submit' | 'event_edit'} expectedAction
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   randomUUID?: () => string,
 *   timeoutSignal?: (milliseconds: number) => AbortSignal,
 * }} [options]
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstileToken(token, req, expectedAction, options = {}) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return false
  }
  if (!validActions.has(expectedAction)) {
    return false
  }

  const configuration = turnstileConfiguration(req)
  if (!configuration) {
    return false
  }

  const fetchImpl = options.fetchImpl || fetch
  const createIdempotencyKey = options.randomUUID || randomUUID
  const createTimeoutSignal = options.timeoutSignal
    || ((milliseconds) => AbortSignal.timeout(milliseconds))
  const remoteIp = requestIp(req)
  const requestBody = {
    secret: configuration.secretKey,
    response: token,
    idempotency_key: createIdempotencyKey(),
    ...(remoteIp ? { remoteip: remoteIp } : {}),
  }

  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: createTimeoutSignal(SITEVERIFY_TIMEOUT_MS),
    })
    if (!response.ok) {
      return false
    }

    const data = await response.json()
    if (data?.success !== true || data?.action !== expectedAction) {
      return false
    }
    if (
      configuration.expectedHostname
      && data?.hostname !== configuration.expectedHostname
    ) {
      return false
    }

    return true
  } catch {
    return false
  }
}
