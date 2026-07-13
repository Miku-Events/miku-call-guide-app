export const CACHE_FRESH_MS = 24 * 60 * 60 * 1000
export const CACHE_MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000

export type CacheFreshness = 'fresh' | 'stale'

interface CacheEnvelope<T> {
  savedAt: string
  value: T
}

export interface CacheEntry<T> extends CacheEnvelope<T> {
  freshness: CacheFreshness
}

type CacheFamily = 'call-guide' | 'event-calendar'

export function cacheStorageKey(key: string): string {
  return `miku-call-guide:${key}`
}

function sortedQuery(url: URL): string {
  const entries = [...url.searchParams.entries()].sort(([leftKey], [rightKey]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1
    return 0
  })
  const query = new URLSearchParams()
  for (const [key, value] of entries) {
    query.append(key, value)
  }
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}

export function normalizeManifestIdentity(manifestUrl: string): string {
  const url = new URL(manifestUrl)
  return `${url.origin}${url.pathname}${sortedQuery(url)}`
}

function normalizeResourcePath(manifestUrl: string, resourcePath: string): string {
  if (resourcePath.startsWith('@')) {
    return resourcePath
  }
  const url = new URL(resourcePath, manifestUrl)
  return `${url.pathname}${sortedQuery(url)}`
}

export function resourceCacheKey(manifestUrl: string, dataVersion: string, resourcePath: string): string {
  return [
    'data-resource',
    encodeURIComponent(normalizeManifestIdentity(manifestUrl)),
    encodeURIComponent(dataVersion),
    encodeURIComponent(normalizeResourcePath(manifestUrl, resourcePath)),
  ].join(':')
}

export function familyPointerCacheKey(rootManifestUrl: string, family: CacheFamily): string {
  return `data-family:${encodeURIComponent(normalizeManifestIdentity(rootManifestUrl))}:${family}`
}

function localStorageOrNull(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function saveCache<T>(key: string, value: T): boolean {
  const storage = localStorageOrNull()
  if (!storage) {
    return false
  }

  try {
    const envelope: CacheEnvelope<T> = {
      savedAt: new Date().toISOString(),
      value,
    }
    storage.setItem(cacheStorageKey(key), JSON.stringify(envelope))
    return true
  } catch {
    return false
  }
}

export function removeCache(key: string): void {
  const storage = localStorageOrNull()
  if (!storage) {
    return
  }
  try {
    storage.removeItem(cacheStorageKey(key))
  } catch {
    // Storage cleanup is best effort. A blocked store behaves like a miss.
  }
}

export function loadCache<T>(key: string): CacheEntry<T> | null {
  const storage = localStorageOrNull()
  if (!storage) {
    return null
  }

  let raw: string | null
  try {
    raw = storage.getItem(cacheStorageKey(key))
  } catch {
    return null
  }
  if (!raw) {
    return null
  }

  try {
    const envelope = JSON.parse(raw) as unknown
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      typeof (envelope as CacheEnvelope<T>).savedAt !== 'string' ||
      !Object.hasOwn(envelope, 'value')
    ) {
      removeCache(key)
      return null
    }

    const typed = envelope as CacheEnvelope<T>
    const savedAtMs = new Date(typed.savedAt).getTime()
    if (!Number.isFinite(savedAtMs)) {
      removeCache(key)
      return null
    }
    const ageMs = Date.now() - savedAtMs
    if (ageMs < 0 || ageMs > CACHE_MAX_STALE_MS) {
      removeCache(key)
      return null
    }
    return {
      ...typed,
      freshness: ageMs <= CACHE_FRESH_MS ? 'fresh' : 'stale',
    }
  } catch {
    removeCache(key)
    return null
  }
}
