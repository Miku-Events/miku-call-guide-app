import { randomUUID } from 'node:crypto'
import { canonicalProductionOrigin } from './productionHostname.js'

export const JSON_BODY_LIMIT_BYTES = 16 * 1024

const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
const API_SECURITY_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
})
const jsonMediaTypePattern = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i

export class HttpError extends Error {
  constructor(status, code, details, logMetadata) {
    super(code)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
    this.logMetadata = logMetadata
  }
}

export function isJsonMediaType(value) {
  const mediaType = String(value || '').split(';', 1)[0].trim()
  return jsonMediaTypePattern.test(mediaType)
}

function responseHeaders(headers) {
  return headers instanceof Headers ? headers : new Headers(headers)
}

export function requestOrigin(request) {
  try {
    const url = new URL(request.url)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
    ) {
      return ''
    }
    return url.origin
  } catch {
    return ''
  }
}

export function runtimeRequestOrigin(request, environment) {
  const origin = requestOrigin(request)
  if (!origin) return ''

  const secureEnvironment = environment?.APP_ENV === 'preview'
    || environment?.APP_ENV === 'production'
  return !secureEnvironment || new URL(origin).protocol === 'https:' ? origin : ''
}

export function jsonResponse(body, status = 200, headers) {
  const resultHeaders = responseHeaders(headers)
  resultHeaders.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers: resultHeaders })
}

export function redirectResponse(url, status = 302, headers) {
  const resultHeaders = responseHeaders(headers)
  resultHeaders.set('location', url)
  return new Response(null, { status, headers: resultHeaders })
}

export function emptyResponse(status = 204, headers) {
  return new Response(null, { status, headers: responseHeaders(headers) })
}

async function cancelBody(request) {
  try {
    await request.body?.cancel()
  } catch {
    // The body may already be locked or closed. The response contract still wins.
  }
}

export async function readJsonBody(request) {
  if (!isJsonMediaType(request.headers.get('content-type'))) {
    await cancelBody(request)
    throw new HttpError(415, 'unsupported_media_type')
  }

  const declaredLength = Number.parseInt(request.headers.get('content-length') || '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > JSON_BODY_LIMIT_BYTES) {
    await cancelBody(request)
    throw new HttpError(413, 'request_body_too_large')
  }

  const reader = request.body?.getReader()
  if (!reader) {
    throw new HttpError(400, 'invalid_json')
  }

  const chunks = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > JSON_BODY_LIMIT_BYTES) {
        await reader.cancel()
        throw new HttpError(413, 'request_body_too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  if (byteLength === 0) {
    throw new HttpError(400, 'invalid_json')
  }

  const serialized = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    serialized.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(serialized)
  } catch {
    throw new HttpError(400, 'invalid_json')
  }

  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'invalid_json')
    }
    return body
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid_json')
  }
}

function applyApiHeaders(response, request, environment, requestId, method) {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    response.headers.set(name, value)
  }
  response.headers.set('content-security-policy', API_CONTENT_SECURITY_POLICY)
  response.headers.set('x-request-id', requestId)
  response.headers.set('allow', method)
  response.headers.set('access-control-allow-headers', 'content-type, idempotency-key')
  response.headers.set('access-control-allow-methods', 'GET,POST,OPTIONS')
  response.headers.set(
    'access-control-expose-headers',
    'idempotency-replayed, retry-after, x-request-id',
  )

  const origin = request.headers.get('origin') || ''
  const requestUrlOrigin = runtimeRequestOrigin(request, environment)
  const secureEnvironment = environment.APP_ENV === 'preview'
    || environment.APP_ENV === 'production'
  let allowedOrigin = environment.APP_ENV === 'preview' ? requestUrlOrigin : ''

  if (environment.APP_ENV === 'production') {
    const configuredOrigin = canonicalProductionOrigin(environment.APP_ORIGIN)
    allowedOrigin = configuredOrigin && configuredOrigin === requestUrlOrigin
      ? configuredOrigin
      : ''
  }

  if (!secureEnvironment && (environment.APP_ENV === 'local' || environment.APP_ENV === 'test')) {
    try {
      const configuredOrigin = new URL(environment.APP_ORIGIN || '').origin
      allowedOrigin = configuredOrigin === environment.APP_ORIGIN
        ? configuredOrigin
        : requestUrlOrigin
    } catch {
      allowedOrigin = requestUrlOrigin
    }
  }

  if (allowedOrigin && origin === allowedOrigin) {
    response.headers.set('access-control-allow-origin', allowedOrigin)
    response.headers.set('access-control-allow-credentials', 'true')
    response.headers.set('vary', 'origin')
  }
  return response
}

function logSanitizedResult(request, requestId, code, metadata = {}, level = 'error') {
  let endpoint = '/'
  try {
    endpoint = new URL(request.url).pathname
  } catch {
    // Keep the sanitized fallback.
  }
  const entry = JSON.stringify({
    endpoint,
    requestId,
    resultCode: code,
    rollback: typeof metadata.rollback === 'boolean' ? metadata.rollback : null,
    replay: typeof metadata.replay === 'boolean' ? metadata.replay : null,
  })
  if (level === 'info') console.info(entry)
  else console.error(entry)
}

export function createApiHandler({
  method,
  jsonBody = false,
  fallback = { code: 'upstream_failed', status: 502 },
  headers: configuredHeaders,
  audit = false,
  preflight,
}, operation) {
  return async function onRequest(context) {
    const request = context.request
    const environment = context.env || {}
    const requestId = randomUUID()
    const headers = new Headers(configuredHeaders)
    const operationContext = {
      request,
      env: environment,
      params: context.params || {},
      body: undefined,
      requestId,
      headers,
      logMetadata: {},
      resultCode: 'ok',
    }

    let response
    try {
      if (request.method === 'OPTIONS') {
        response = emptyResponse(204, headers)
      } else if (request.method !== method) {
        response = jsonResponse({ error: 'method_not_allowed', requestId }, 405, headers)
      } else {
        if (preflight) {
          await preflight(operationContext)
        }
        if (jsonBody) {
          operationContext.body = await readJsonBody(request)
        }
        response = await operation(operationContext)
        if (!(response instanceof Response)) {
          throw new Error('API operation must return a Response')
        }
        if (audit) {
          logSanitizedResult(
            request,
            requestId,
            operationContext.resultCode,
            operationContext.logMetadata,
            'info',
          )
        }
      }
    } catch (error) {
      const known = error instanceof HttpError
      const status = known ? error.status : fallback.status
      const code = known ? error.code : fallback.code
      const details = known && error.details?.length ? { details: error.details } : {}
      const logMetadata = known && error.logMetadata
        ? { ...operationContext.logMetadata, ...error.logMetadata }
        : operationContext.logMetadata
      if (status >= 500 || audit) {
        logSanitizedResult(request, requestId, code, logMetadata)
      }
      response = jsonResponse({ error: code, requestId, ...details }, status, headers)
    }

    return applyApiHeaders(response, request, environment, requestId, method)
  }
}
