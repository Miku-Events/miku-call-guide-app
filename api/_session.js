import { createHmac, randomBytes } from 'node:crypto'

const cookieName = 'miku_call_guide_session'

function secret() {
  const value = process.env.SESSION_SECRET
  if (!value) {
    throw new Error('SESSION_SECRET is not configured')
  }
  return value
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function sign(value) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

export function signState(payload) {
  const body = base64Url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

export function verifyState(value) {
  const [body, signature] = String(value || '').split('.')
  if (!body || !signature || sign(body) !== signature) {
    return null
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function createState(returnTo) {
  return signState({
    nonce: randomBytes(12).toString('hex'),
    returnTo,
    ts: Date.now(),
  })
}

export function setSessionCookie(res, session) {
  const body = base64Url(JSON.stringify(session))
  const value = `${body}.${sign(body)}`
  res.setHeader(
    'set-cookie',
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}`,
  )
}

export function readSession(req) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=')
        return [item.slice(0, index), item.slice(index + 1)]
      }),
  )
  const value = cookies[cookieName]
  if (!value) {
    return null
  }

  const [body, signature] = value.split('.')
  if (!body || !signature || sign(body) !== signature) {
    return null
  }

  try {
    const session = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
    if (!session.ts || Date.now() - session.ts > MAX_AGE_MS) {
      return null
    }

    return session
  } catch {
    return null
  }
}
