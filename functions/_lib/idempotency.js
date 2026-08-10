import { createHash } from 'node:crypto'
import { normalizeIdempotencyKey } from './input.js'
import { HttpError } from './http.js'

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function requestIdempotencyKey(request, actorId, canonicalPayload, now = Date.now()) {
  const header = request.headers.get('idempotency-key')
  if (header !== null) {
    const normalized = normalizeIdempotencyKey(header)
    if (!normalized) throw new HttpError(400, 'invalid_idempotency_key')
    return normalized
  }
  const bucket = Math.floor(now / (10 * 60 * 1000))
  return `fallback-${sha256Hex(`${actorId}\0${canonicalPayload}\0${bucket}`)}`
}
