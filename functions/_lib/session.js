import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

const LEGACY_SESSION_COOKIE_NAME = 'miku_call_guide_session'
const SECURE_SESSION_COOKIE_NAME = '__Host-miku_call_guide_session'
const LOCAL_OAUTH_COOKIE_NAME = 'miku_call_guide_oauth'
const SECURE_OAUTH_COOKIE_NAME = '__Host-miku_call_guide_oauth'

const OAUTH_TTL_SECONDS = 10 * 60
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const OAUTH_TTL_MS = OAUTH_TTL_SECONDS * 1000
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000

function secret(environment) {
  const value = environment.SESSION_SECRET
  if (!value) {
    throw new Error('SESSION_SECRET is not configured')
  }

  if (Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error('SESSION_SECRET must be at least 32 UTF-8 bytes')
  }

  const normalized = value.trim().toLowerCase()
  if (
    normalized.startsWith('replace-with-')
    || normalized.startsWith('your_')
    || normalized.startsWith('your-')
    || normalized === 'changeme'
    || normalized === 'change-me'
  ) {
    throw new Error('SESSION_SECRET cannot use a placeholder value')
  }

  return value
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function sign(value, environment) {
  return createHmac('sha256', secret(environment)).update(value).digest('base64url')
}

export function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ''), 'utf8')
  const rightBytes = Buffer.from(String(right || ''), 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function readSignedJson(value, environment) {
  const parts = String(value || '').split('.')
  if (parts.length !== 2) {
    return null
  }

  const [body, signature] = parts
  if (!body || !signature || !constantTimeEqual(sign(body, environment), signature)) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function hasValidTimestamp(value, ttlMs) {
  if (!Number.isFinite(value?.ts)) {
    return false
  }
  const age = Date.now() - value.ts
  return age >= 0 && age <= ttlMs
}

function appEnvironment(environment) {
  const value = environment.APP_ENV
  if (!['local', 'test', 'preview', 'production'].includes(value)) {
    throw new Error('APP_ENV must be local, test, preview, or production')
  }
  return value
}

function isSecureEnvironment(environment) {
  const value = appEnvironment(environment)
  return value === 'production' || value === 'preview'
}

function sessionCookieName(environment) {
  return isSecureEnvironment(environment)
    ? SECURE_SESSION_COOKIE_NAME
    : LEGACY_SESSION_COOKIE_NAME
}

function oauthCookieName(environment) {
  return isSecureEnvironment(environment)
    ? SECURE_OAUTH_COOKIE_NAME
    : LOCAL_OAUTH_COOKIE_NAME
}

function cookieAttributes(maxAgeSeconds, secure) {
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ')
}

function expiredCookie(name, secure) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0${secure ? '; Secure' : ''}`
}

function appendSetCookie(headers, value) {
  headers.append('set-cookie', value)
}

function parseCookies(request) {
  const cookies = {}
  for (const item of String(request.headers.get('cookie') || '').split(';')) {
    const trimmed = item.trim()
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      continue
    }
    cookies[trimmed.slice(0, separator)] = trimmed.slice(separator + 1)
  }
  return cookies
}

export function signState(payload, environment) {
  const body = base64Url(JSON.stringify(payload))
  return `${body}.${sign(body, environment)}`
}

export function verifyState(value, environment) {
  const payload = readSignedJson(value, environment)
  if (!payload || !hasValidTimestamp(payload, OAUTH_TTL_MS)) {
    return null
  }
  return payload
}

export function createState(returnTo, environment) {
  return signState({
    nonce: randomBytes(32).toString('base64url'),
    returnTo,
    ts: Date.now(),
  }, environment)
}

export function createOAuthTransaction(returnTo, environment) {
  const ts = Date.now()
  const state = signState({
    nonce: randomBytes(32).toString('base64url'),
    returnTo,
    ts,
  }, environment)
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

  return { codeChallenge, codeVerifier, state, ts }
}

export function setOAuthTransactionCookie(headers, transaction, environment) {
  const value = signState({
    state: transaction.state,
    codeVerifier: transaction.codeVerifier,
    ts: transaction.ts,
  }, environment)
  appendSetCookie(
    headers,
    `${oauthCookieName(environment)}=${value}; ${cookieAttributes(OAUTH_TTL_SECONDS, isSecureEnvironment(environment))}`,
  )
}

export function readOAuthTransaction(request, environment) {
  const value = parseCookies(request)[oauthCookieName(environment)]
  const transaction = readSignedJson(value, environment)
  if (
    !transaction
    || !hasValidTimestamp(transaction, OAUTH_TTL_MS)
    || typeof transaction.state !== 'string'
    || !/^[A-Za-z0-9._~-]{43,128}$/.test(transaction.codeVerifier || '')
  ) {
    return null
  }
  return transaction
}

export function clearOAuthTransactionCookie(headers, environment) {
  appendSetCookie(
    headers,
    expiredCookie(oauthCookieName(environment), isSecureEnvironment(environment)),
  )
}

export function clearAllOAuthTransactionCookies(headers) {
  appendSetCookie(headers, expiredCookie(SECURE_OAUTH_COOKIE_NAME, true))
  appendSetCookie(headers, expiredCookie(LOCAL_OAUTH_COOKIE_NAME, false))
}

export function setSessionCookie(headers, session, environment) {
  const body = base64Url(JSON.stringify(session))
  const value = `${body}.${sign(body, environment)}`
  appendSetCookie(
    headers,
    `${sessionCookieName(environment)}=${value}; ${cookieAttributes(SESSION_TTL_SECONDS, isSecureEnvironment(environment))}`,
  )
}

export function readSession(request, environment) {
  const cookies = parseCookies(request)
  const names = [sessionCookieName(environment), LEGACY_SESSION_COOKIE_NAME]
  const value = names.map((name) => cookies[name]).find(Boolean)
  if (!value) {
    return null
  }

  const session = readSignedJson(value, environment)
  if (!session || !hasValidTimestamp(session, SESSION_TTL_MS)) {
    return null
  }
  return session
}

export function clearAllAuthCookies(headers) {
  for (const [name, secure] of [
    [SECURE_SESSION_COOKIE_NAME, true],
    [LEGACY_SESSION_COOKIE_NAME, false],
    [SECURE_OAUTH_COOKIE_NAME, true],
    [LOCAL_OAUTH_COOKIE_NAME, false],
  ]) {
    appendSetCookie(headers, expiredCookie(name, secure))
  }
}
