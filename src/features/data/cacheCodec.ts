export interface CacheEnvelope<T> {
  savedAt: string
  value: T
}

export interface ParsedCacheEnvelope<T> extends CacheEnvelope<T> {
  savedAtMs: number
}

export function parseCacheEnvelope<T = unknown>(raw: string): ParsedCacheEnvelope<T> | null {
  try {
    const envelope = JSON.parse(raw) as unknown
    if (
      !envelope
      || typeof envelope !== 'object'
      || typeof (envelope as CacheEnvelope<unknown>).savedAt !== 'string'
      || !Object.hasOwn(envelope, 'value')
    ) {
      return null
    }
    const typed = envelope as CacheEnvelope<T>
    const savedAtMs = new Date(typed.savedAt).getTime()
    return Number.isFinite(savedAtMs) ? { ...typed, savedAtMs } : null
  } catch {
    return null
  }
}

export function serializeCacheEnvelope(value: unknown, savedAt = new Date().toISOString()): string | null {
  try {
    return JSON.stringify({ savedAt, value } satisfies CacheEnvelope<unknown>)
  } catch {
    return null
  }
}

export function storedCacheBytes(key: string, raw: string): number {
  return 2 * (key.length + raw.length)
}
