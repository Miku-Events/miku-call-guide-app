import { randomUUID } from 'node:crypto'

export const JSON_BODY_LIMIT_BYTES = 16 * 1024
const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

const API_SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
})

const requestIds = new WeakMap()
const jsonMediaTypePattern = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i

function processEnvironment() {
  return typeof process !== 'undefined' && process.env ? process.env : {}
}

function requestHeader(req, name) {
  const headers = req?.headers
  if (!headers) return ''
  if (typeof headers.get === 'function') {
    return headers.get(name) || ''
  }

  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name)
  const value = matchingKey ? headers[matchingKey] : ''
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

export class HttpError extends Error {
  constructor(status, code, details) {
    super(code)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export function isJsonMediaType(value) {
  const mediaType = String(value || '').split(';', 1)[0].trim()
  return jsonMediaTypePattern.test(mediaType)
}

export function getRequestId(req) {
  if (!requestIds.has(req)) {
    requestIds.set(req, randomUUID())
  }
  return requestIds.get(req)
}

export function prepareApiResponse(req, res) {
  const requestId = getRequestId(req)
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    res.setHeader(name, value)
  }
  res.setHeader('content-security-policy', API_CONTENT_SECURITY_POLICY)
  res.setHeader('x-request-id', requestId)
  return requestId
}

export function setCors(req, res) {
  prepareApiResponse(req, res)
  const environment = req?.env || processEnvironment()
  const allowedOrigin = environment.APP_ORIGIN
  const requestOrigin = requestHeader(req, 'origin')
  if (allowedOrigin && requestOrigin === allowedOrigin) {
    res.setHeader('access-control-allow-origin', allowedOrigin)
    res.setHeader('vary', 'origin')
    res.setHeader('access-control-allow-credentials', 'true')
  }
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
}

export function handleOptions(req, res) {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true
  }
  return false
}

export function json(res, status, body) {
  res.status(status).json(body)
}

export function apiError(req, res, status, error, details) {
  const body = {
    error,
    requestId: prepareApiResponse(req, res),
    ...(details?.length ? { details } : {}),
  }
  json(res, status, body)
}

export function requireMethod(req, res, method) {
  prepareApiResponse(req, res)
  if (req.method !== method) {
    res.setHeader('allow', method)
    apiError(req, res, 405, 'method_not_allowed')
    return false
  }
  return true
}

export function readBody(req) {
  if (!isJsonMediaType(requestHeader(req, 'content-type'))) {
    throw new HttpError(415, 'unsupported_media_type')
  }

  const declaredLength = Number.parseInt(requestHeader(req, 'content-length'), 10)
  if (Number.isFinite(declaredLength) && declaredLength > JSON_BODY_LIMIT_BYTES) {
    throw new HttpError(413, 'request_body_too_large')
  }

  let serialized
  if (typeof req.body === 'string') {
    serialized = req.body
  } else {
    try {
      serialized = JSON.stringify(req.body)
    } catch {
      throw new HttpError(400, 'invalid_json')
    }
  }

  if (typeof serialized !== 'string' || serialized.length === 0) {
    throw new HttpError(400, 'invalid_json')
  }
  if (byteLength(serialized) > JSON_BODY_LIMIT_BYTES) {
    throw new HttpError(413, 'request_body_too_large')
  }

  if (typeof req.body === 'object' && req.body !== null) {
    return req.body
  }

  try {
    const parsed = JSON.parse(serialized)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'invalid_json')
    }
    return parsed
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid_json')
  }
}

export function respondWithError(req, res, error, fallback = {}) {
  if (error instanceof HttpError) {
    if (error.status >= 500) {
      logSanitizedError(req, error.code)
    }
    apiError(req, res, error.status, error.code, error.details)
    return
  }

  const status = fallback.status || 502
  const code = fallback.code || 'upstream_failed'
  logSanitizedError(req, code)
  apiError(req, res, status, code)
}

export function logSanitizedError(req, code) {
  const payload = {
    endpoint: (() => {
      try {
        return new URL(req?.url || '/', 'https://local.invalid').pathname
      } catch {
        return '/'
      }
    })(),
    githubUser: typeof req?.authUser === 'string' ? req.authUser : null,
    requestId: getRequestId(req),
    resultCode: code,
  }
  console.error(JSON.stringify(payload))
}

export function apiSecurityHeaders() {
  return {
    ...API_SECURITY_HEADERS,
    'content-security-policy': API_CONTENT_SECURITY_POLICY,
  }
}
