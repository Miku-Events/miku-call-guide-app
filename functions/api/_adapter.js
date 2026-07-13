import {
  apiError,
  HttpError,
  isJsonMediaType,
  JSON_BODY_LIMIT_BYTES,
  prepareApiResponse,
  respondWithError,
  setCors,
} from '../../api/_http.js'

function requiresStrictJsonBody(request) {
  if (request.method !== 'POST') return false
  const pathname = new URL(request.url).pathname
  return pathname === '/api/events/submissions'
    || /^\/api\/events\/[^/]+\/edit-requests$/.test(pathname)
}

async function readLimitedBody(request) {
  if (!isJsonMediaType(request.headers.get('content-type'))) {
    throw new HttpError(415, 'unsupported_media_type')
  }

  const declaredLength = Number.parseInt(request.headers.get('content-length') || '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > JSON_BODY_LIMIT_BYTES) {
    try {
      await request.body?.cancel()
    } catch {
      // Cancellation is best-effort; preserve the intended public 413 contract.
    }
    throw new HttpError(413, 'request_body_too_large')
  }

  const reader = request.body?.getReader()
  if (!reader) {
    throw new HttpError(400, 'invalid_json')
  }

  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > JSON_BODY_LIMIT_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // Cancellation is best-effort; preserve the intended public 413 contract.
        }
        throw new HttpError(413, 'request_body_too_large')
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // A runtime may already have released the lock after cancellation.
    }
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

function createResponseAdapter(req) {
  let statusCode = 200
  const headers = new Headers()
  let responseBody = null
  let redirectUrl = null

  const response = {
    status(code) {
      statusCode = code
      return this
    },
    setHeader(name, value) {
      headers.delete(name)
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) {
        headers.append(name, String(item))
      }
      return this
    },
    appendHeader(name, value) {
      const values = Array.isArray(value) ? value : [value]
      for (const item of values) {
        headers.append(name, String(item))
      }
      return this
    },
    getHeader(name) {
      return headers.get(name) || undefined
    },
    json(body) {
      responseBody = JSON.stringify(body)
      headers.set('content-type', 'application/json')
      return this
    },
    redirect(url) {
      statusCode = 302
      redirectUrl = url
      return this
    },
    end() {
      return this
    },
  }

  prepareApiResponse(req, response)

  return {
    response,
    toResponse() {
      if (redirectUrl) {
        headers.set('location', redirectUrl)
      }
      const body = redirectUrl || statusCode === 204 ? null : responseBody
      return new Response(body, {
        headers,
        status: statusCode,
      })
    },
  }
}

export function cloudflareAdapter(vercelHandler) {
  return async (context) => {
    const { request, env, params } = context
    const url = new URL(request.url)
    const req = {
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      env,
      query: {
        ...Object.fromEntries(url.searchParams.entries()),
        ...params,
      },
    }
    const adapter = createResponseAdapter(req)
    const res = adapter.response
    setCors(req, res)

    try {
      if (requiresStrictJsonBody(request)) {
        req.body = await readLimitedBody(request)
      }
      await vercelHandler(req, res)
    } catch (error) {
      if (error instanceof HttpError) {
        apiError(req, res, error.status, error.code, error.details)
      } else {
        respondWithError(req, res, error, {
          code: 'service_unavailable',
          status: 503,
        })
      }
    }

    return adapter.toResponse()
  }
}
