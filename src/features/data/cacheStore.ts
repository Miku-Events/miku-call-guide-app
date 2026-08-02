export const CACHE_FRESH_MS = 24 * 60 * 60 * 1000
export const CACHE_MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000
export const CACHE_NAMESPACE_MAX_BYTES = 4 * 1024 * 1024

const CACHE_NAMESPACE = 'miku-call-guide:'
const snapshotGenerationPattern = /^[a-f0-9]{32}$/

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
  return `${CACHE_NAMESPACE}${key}`
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

interface CacheSweepOptions {
  currentDataVersion?: string
  protectKeys?: Iterable<string>
  reserveBytes?: number
  transientProtectKeys?: Iterable<string>
}

interface SaveCacheOptions extends CacheSweepOptions {
  retryQuota?: boolean
}

interface StoredEntry {
  innerKey: string
  raw: string
  savedAtMs: number
  storageKey: string
}

interface ParsedResourceKey {
  dataVersion: string
  resource: string
}

interface ParsedFamilyPointerKey {
  family: CacheFamily
  rootIdentity: string
}

function parseStoredEntry(storageKey: string, raw: string): StoredEntry | null {
  if (!storageKey.startsWith(CACHE_NAMESPACE)) {
    return null
  }
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
    const savedAtMs = new Date((envelope as CacheEnvelope<unknown>).savedAt).getTime()
    if (!Number.isFinite(savedAtMs)) {
      return null
    }
    return {
      innerKey: storageKey.slice(CACHE_NAMESPACE.length),
      raw,
      savedAtMs,
      storageKey,
    }
  } catch {
    return null
  }
}

function parseResourceKey(innerKey: string): ParsedResourceKey | null {
  const segments = innerKey.split(':')
  if (segments.length !== 4 || segments[0] !== 'data-resource') {
    return null
  }
  try {
    return {
      dataVersion: decodeURIComponent(segments[2]),
      resource: decodeURIComponent(segments[3]),
    }
  } catch {
    return null
  }
}

function parseFamilyPointerKey(innerKey: string): ParsedFamilyPointerKey | null {
  const segments = innerKey.split(':')
  if (
    segments.length !== 3
    || segments[0] !== 'data-family'
    || !['call-guide', 'event-calendar'].includes(segments[2])
  ) {
    return null
  }
  try {
    return {
      family: segments[2] as CacheFamily,
      rootIdentity: decodeURIComponent(segments[1]),
    }
  } catch {
    return null
  }
}

function namespaceEntries(storage: Storage): Array<{ key: string; raw: string }> {
  const entries: Array<{ key: string; raw: string }> = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (
      !key?.startsWith(`${CACHE_NAMESPACE}data-resource:`)
      && !key?.startsWith(`${CACHE_NAMESPACE}data-family:`)
    ) {
      continue
    }
    const raw = storage.getItem(key)
    if (raw !== null) {
      entries.push({ key, raw })
    }
  }
  return entries
}

function storedBytes(key: string, raw: string): number {
  // Web Storage stores DOMStrings, so count UTF-16 code units rather than UTF-8 bytes.
  return 2 * (key.length + raw.length)
}

function envelopeValue(raw: string): unknown {
  try {
    const envelope = JSON.parse(raw) as CacheEnvelope<unknown>
    return envelope.value
  } catch {
    return undefined
  }
}

function validPointerBackingKeys(
  entries: Array<{ key: string; raw: string }>,
  now: number,
): { invalidPointerKeys: Set<string>; protectedKeys: Set<string> } {
  const byKey = new Map(entries.map((entry) => [entry.key, entry.raw]))
  const protectedKeys = new Set<string>()
  const invalidPointerKeys = new Set<string>()
  for (const entry of entries) {
    if (!entry.key.startsWith(`${CACHE_NAMESPACE}data-family:`)) {
      continue
    }
    try {
      const pointerKey = parseFamilyPointerKey(entry.key.slice(CACHE_NAMESPACE.length))
      const parsed = parseStoredEntry(entry.key, entry.raw)
      const pointer = envelopeValue(entry.raw)
      if (
        !pointerKey
        || !parsed
        || now - parsed.savedAtMs < 0
        || now - parsed.savedAtMs > CACHE_MAX_STALE_MS
        || !pointer
        || typeof pointer !== 'object'
        || typeof (pointer as { dataVersion?: unknown }).dataVersion !== 'string'
        || (pointer as { dataVersion: string }).dataVersion === ''
        || typeof (pointer as { rootKey?: unknown }).rootKey !== 'string'
        || typeof (pointer as { childKey?: unknown }).childKey !== 'string'
        || typeof (pointer as { rootUrl?: unknown }).rootUrl !== 'string'
        || typeof (pointer as { childUrl?: unknown }).childUrl !== 'string'
        || (Object.hasOwn(pointer, 'generation') && (
          typeof (pointer as { generation?: unknown }).generation !== 'string'
          || !snapshotGenerationPattern.test((pointer as { generation: string }).generation)
        ))
      ) {
        throw new Error('Invalid family pointer envelope.')
      }
      const typedPointer = pointer as {
        childKey: string
        childUrl: string
        dataVersion: string
        generation?: string
        rootKey: string
        rootUrl: string
      }
      if (
        normalizeManifestIdentity(typedPointer.rootUrl) !== pointerKey.rootIdentity
        || normalizeManifestIdentity(pointerKey.rootIdentity) !== pointerKey.rootIdentity
      ) {
        throw new Error('Family pointer root identity mismatch.')
      }
      const rootResource = typedPointer.generation
        ? `@family-snapshot/${pointerKey.family}/${typedPointer.generation}/root`
        : '@root'
      const expectedRootKey = resourceCacheKey(
        typedPointer.rootUrl,
        typedPointer.dataVersion,
        rootResource,
      )
      if (typedPointer.rootKey !== expectedRootKey) {
        throw new Error('Family pointer root namespace mismatch.')
      }
      const rootStorageKey = cacheStorageKey(typedPointer.rootKey)
      const rootRaw = byKey.get(rootStorageKey)
      const rootEntry = rootRaw ? parseStoredEntry(rootStorageKey, rootRaw) : null
      const root = rootRaw ? envelopeValue(rootRaw) : null
      if (
        !rootEntry
        || now - rootEntry.savedAtMs < 0
        || now - rootEntry.savedAtMs > CACHE_MAX_STALE_MS
        || !root
        || typeof root !== 'object'
        || (root as { dataVersion?: unknown }).dataVersion !== typedPointer.dataVersion
        || !(root as { manifests?: unknown }).manifests
        || typeof (root as { manifests: unknown }).manifests !== 'object'
      ) {
        throw new Error('Family pointer root backing was invalid.')
      }
      const childPath = (root as {
        manifests: { callGuide?: unknown; eventCalendar?: unknown }
      }).manifests[pointerKey.family === 'call-guide' ? 'callGuide' : 'eventCalendar']
      if (typeof childPath !== 'string' || childPath === '') {
        throw new Error('Family pointer child path was invalid.')
      }
      const childResource = typedPointer.generation
        ? `@family-snapshot/${pointerKey.family}/${typedPointer.generation}/child/${childPath}`
        : childPath
      const expectedChildKey = resourceCacheKey(
        typedPointer.rootUrl,
        typedPointer.dataVersion,
        childResource,
      )
      if (
        typedPointer.childKey !== expectedChildKey
        || typedPointer.childUrl !== new URL(childPath, typedPointer.rootUrl).toString()
      ) {
        throw new Error('Family pointer child namespace mismatch.')
      }
      const childStorageKey = cacheStorageKey(typedPointer.childKey)
      const childRaw = byKey.get(childStorageKey)
      const childEntry = childRaw ? parseStoredEntry(childStorageKey, childRaw) : null
      const child = childRaw ? envelopeValue(childRaw) : null
      if (
        !childEntry
        || now - childEntry.savedAtMs < 0
        || now - childEntry.savedAtMs > CACHE_MAX_STALE_MS
        || !child
        || typeof child !== 'object'
        || (child as { dataVersion?: unknown }).dataVersion !== typedPointer.dataVersion
      ) {
        throw new Error('Family pointer child backing was invalid.')
      }
      protectedKeys.add(entry.key)
      protectedKeys.add(rootStorageKey)
      protectedKeys.add(childStorageKey)
    } catch {
      invalidPointerKeys.add(entry.key)
    }
  }
  return { invalidPointerKeys, protectedKeys }
}

function removeStorageKeys(storage: Storage, keys: Iterable<string>): void {
  for (const key of keys) {
    try {
      storage.removeItem(key)
    } catch {
      // Cleanup is best effort. A blocked store behaves like a miss.
    }
  }
}

/**
 * Prunes only the data-cache namespace. Other application state sharing the
 * `miku-call-guide:` prefix is never treated as an invalid cache envelope.
 * Complete family pointers and their backing snapshots are never evicted while
 * they are still valid.
 */
export function sweepCache(options: CacheSweepOptions = {}): void {
  const storage = localStorageOrNull()
  if (!storage) {
    return
  }

  try {
    const now = Date.now()
    let entries = namespaceEntries(storage)
    const pointerProtection = validPointerBackingKeys(entries, now)
    const protectedKeys = pointerProtection.protectedKeys
    for (const key of options.protectKeys ?? []) {
      protectedKeys.add(cacheStorageKey(key))
    }
    const cleanupProtectedKeys = new Set(protectedKeys)
    for (const key of options.transientProtectKeys ?? []) {
      cleanupProtectedKeys.add(cacheStorageKey(key))
    }

    const expiredOrInvalid = new Set(pointerProtection.invalidPointerKeys)
    for (const entry of entries) {
      const parsed = parseStoredEntry(entry.key, entry.raw)
      if (
        !parsed
        || now - parsed.savedAtMs < 0
        || now - parsed.savedAtMs > CACHE_MAX_STALE_MS
      ) {
        if (!cleanupProtectedKeys.has(entry.key)) {
          expiredOrInvalid.add(entry.key)
        }
      }
    }
    removeStorageKeys(storage, expiredOrInvalid)

    entries = namespaceEntries(storage)
    const obsoleteOrOrphan = new Set<string>()
    for (const entry of entries) {
      if (cleanupProtectedKeys.has(entry.key)) {
        continue
      }
      const resource = parseResourceKey(entry.key.slice(CACHE_NAMESPACE.length))
      if (!resource) {
        continue
      }
      const orphanSnapshot = resource.resource.startsWith('@family-snapshot/')
      const previousVersion = Boolean(
        options.currentDataVersion
        && resource.dataVersion !== options.currentDataVersion,
      )
      if (orphanSnapshot || previousVersion) {
        obsoleteOrOrphan.add(entry.key)
      }
    }
    removeStorageKeys(storage, obsoleteOrOrphan)

    entries = namespaceEntries(storage)
    let totalBytes = entries.reduce(
      (total, entry) => total + storedBytes(entry.key, entry.raw),
      0,
    )
    const reserveBytes = Number.isSafeInteger(options.reserveBytes) && (options.reserveBytes ?? 0) > 0
      ? options.reserveBytes as number
      : 0
    const targetBytes = Math.max(0, CACHE_NAMESPACE_MAX_BYTES - reserveBytes)
    if (totalBytes <= targetBytes) {
      return
    }

    const evictableLeaves = entries
      .filter((entry) => (
        !protectedKeys.has(entry.key)
        && parseResourceKey(entry.key.slice(CACHE_NAMESPACE.length)) !== null
      ))
      .map((entry) => ({ ...entry, parsed: parseStoredEntry(entry.key, entry.raw) }))
      .sort((left, right) => (
        (left.parsed?.savedAtMs ?? Number.NEGATIVE_INFINITY)
        - (right.parsed?.savedAtMs ?? Number.NEGATIVE_INFINITY)
      ))

    for (const entry of evictableLeaves) {
      if (totalBytes <= targetBytes) {
        break
      }
      try {
        storage.removeItem(entry.key)
        totalBytes -= storedBytes(entry.key, entry.raw)
      } catch {
        // Continue trying other leaves when one removal is blocked.
      }
    }
  } catch {
    // Enumerating localStorage can itself be blocked. Treat it like no cache.
  }
}

function isQuotaError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  }
  return error instanceof Error && /quota/i.test(error.message)
}

export function saveCache<T>(key: string, value: T, options: SaveCacheOptions = {}): boolean {
  const storage = localStorageOrNull()
  if (!storage) {
    return false
  }

  let serialized: string
  try {
    const envelope: CacheEnvelope<T> = {
      savedAt: new Date().toISOString(),
      value,
    }
    serialized = JSON.stringify(envelope)
  } catch {
    return false
  }

  const storageKey = cacheStorageKey(key)
  const protectedKeys = [...options.protectKeys ?? []]
  let replacedBytes = 0
  try {
    const previous = storage.getItem(storageKey)
    if (previous !== null) {
      replacedBytes = storedBytes(storageKey, previous)
    }
  } catch {
    // Conservatively reserve the full payload when the old entry cannot be read.
  }
  const pendingBytes = Math.max(0, storedBytes(storageKey, serialized) - replacedBytes)
  sweepCache({
    currentDataVersion: options.currentDataVersion,
    protectKeys: [...protectedKeys, key],
    reserveBytes: pendingBytes,
  })

  try {
    storage.setItem(storageKey, serialized)
    sweepCache({
      currentDataVersion: options.currentDataVersion,
      protectKeys: protectedKeys,
      transientProtectKeys: [key],
    })
    return true
  } catch (error) {
    if (options.retryQuota === false || !isQuotaError(error)) {
      return false
    }
    sweepCache({
      currentDataVersion: options.currentDataVersion,
      protectKeys: [...protectedKeys, key],
      reserveBytes: pendingBytes,
    })
    try {
      storage.setItem(storageKey, serialized)
      sweepCache({
        currentDataVersion: options.currentDataVersion,
        protectKeys: protectedKeys,
        transientProtectKeys: [key],
      })
      return true
    } catch {
      return false
    }
  }
}

export function cacheNamespaceBytes(): number {
  const storage = localStorageOrNull()
  if (!storage) {
    return 0
  }
  try {
    return namespaceEntries(storage).reduce(
      (total, entry) => total + storedBytes(entry.key, entry.raw),
      0,
    )
  } catch {
    return 0
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
