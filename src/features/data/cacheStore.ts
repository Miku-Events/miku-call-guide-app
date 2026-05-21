interface CacheEnvelope<T> {
  savedAt: string
  value: T
}

function keyFor(key: string): string {
  return `miku-call-guide:${key}`
}

export function saveCache<T>(key: string, value: T): void {
  if (typeof window === 'undefined') {
    return
  }

  const envelope: CacheEnvelope<T> = {
    savedAt: new Date().toISOString(),
    value,
  }

  window.localStorage.setItem(keyFor(key), JSON.stringify(envelope))
}

export function loadCache<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(keyFor(key))
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as CacheEnvelope<T>
  } catch {
    window.localStorage.removeItem(keyFor(key))
    return null
  }
}

export function removeCache(key: string): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(keyFor(key))
}
