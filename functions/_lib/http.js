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
const jsonMediaTypePattern = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i

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

function responseHeaders(headers) {
  return headers instanceof Headers ? headers : new Headers(headers)
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
  response.headers.set('access-control-allow-headers', 'content-type')
  response.headers.set('access-control-allow-methods', 'GET,POST,OPTIONS')

  const origin = request.headers.get('origin') || ''
  if (environment.APP_ORIGIN && origin === environment.APP_ORIGIN) {
    response.headers.set('access-control-allow-origin', environment.APP_ORIGIN)
    response.headers.set('access-control-allow-credentials', 'true')
    response.headers.set('vary', 'origin')
  }
  return response
}

function logSanitizedError(request, requestId, authUser, code) {
  let endpoint = '/'
  try {
    endpoint = new URL(request.url).pathname
  } catch {
    // Keep the sanitized fallback.
  }
  console.error(JSON.stringify({
    endpoint,
    githubUser: typeof authUser === 'string' ? authUser : null,
    requestId,
    resultCode: code,
  }))
}

export function createApiHandler({
  method,
  jsonBody = false,
  fallback = { code: 'upstream_failed', status: 502 },
  headers: configuredHeaders,
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
      authUser: null,
    }

    let response
    try {
      if (request.method === 'OPTIONS') {
        response = emptyResponse(204, headers)
      } else if (request.method !== method) {
        response = jsonResponse({ error: 'method_not_allowed', requestId }, 405, headers)
      } else {
        if (jsonBody) {
          operationContext.body = await readJsonBody(request)
        }
        response = await operation(operationContext)
        if (!(response instanceof Response)) {
          throw new Error('API operation must return a Response')
        }
      }
    } catch (error) {
      const known = error instanceof HttpError
      const status = known ? error.status : fallback.status
      const code = known ? error.code : fallback.code
      const details = known && error.details?.length ? { details: error.details } : {}
      if (status >= 500) {
        logSanitizedError(request, requestId, operationContext.authUser, code)
      }
      response = jsonResponse({ error: code, requestId, ...details }, status, headers)
    }

    return applyApiHeaders(response, request, environment, requestId, method)
  }
}

export function apiSecurityHeaders() {
  return {
    ...API_SECURITY_HEADERS,
    'content-security-policy': API_CONTENT_SECURITY_POLICY,
  }
}
