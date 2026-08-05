export const CACHE_FRESH_MS = 24 * 60 * 60 * 1000
export const CACHE_MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000
export const CACHE_NAMESPACE_MAX_BYTES = 4 * 1024 * 1024
export const CACHE_STAGING_MAX_MS = 60 * 1000

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

export type CacheFamily = 'call-guide' | 'event-calendar'

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

function familyStagingCacheKey(
  rootManifestUrl: string,
  family: CacheFamily,
  generation: string,
): string {
  return [
    'data-staging',
    encodeURIComponent(normalizeManifestIdentity(rootManifestUrl)),
    family,
    generation,
  ].join(':')
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

export interface CacheBatchWrite {
  key: string
  value: unknown
}

export interface CommitCacheBatchOptions {
  currentDataVersion: string
  pointer: CacheBatchWrite
  retryQuota?: boolean
  staging: {
    family: CacheFamily
    generation: string
    rootManifestUrl: string
  }
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
  rootIdentity: string
}

interface ParsedFamilyPointerKey {
  family: CacheFamily
  rootIdentity: string
}

interface ParsedStagingKey extends ParsedFamilyPointerKey {
  generation: string
}

interface StagingMarker {
  dataVersion: string
  pointerKey: string
  resourceKeys: string[]
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
      rootIdentity: decodeURIComponent(segments[1]),
    }
  } catch {
    return null
  }
}

function parseStagingKey(innerKey: string): ParsedStagingKey | null {
  const segments = innerKey.split(':')
  if (
    segments.length !== 4
    || segments[0] !== 'data-staging'
    || !['call-guide', 'event-calendar'].includes(segments[2])
    || !snapshotGenerationPattern.test(segments[3])
  ) {
    return null
  }
  try {
    return {
      family: segments[2] as CacheFamily,
      generation: segments[3],
      rootIdentity: decodeURIComponent(segments[1]),
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
      && !key?.startsWith(`${CACHE_NAMESPACE}data-staging:`)
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

function validStagingBackingKeys(
  entries: Array<{ key: string; raw: string }>,
  now: number,
): { invalidMarkerKeys: Set<string>; protectedKeys: Set<string> } {
  const invalidMarkerKeys = new Set<string>()
  const protectedKeys = new Set<string>()
  for (const entry of entries) {
    if (!entry.key.startsWith(`${CACHE_NAMESPACE}data-staging:`)) {
      continue
    }
    try {
      const markerKey = parseStagingKey(entry.key.slice(CACHE_NAMESPACE.length))
      const parsed = parseStoredEntry(entry.key, entry.raw)
      const marker = envelopeValue(entry.raw)
      if (
        !markerKey
        || !parsed
        || now - parsed.savedAtMs < 0
        || now - parsed.savedAtMs > CACHE_STAGING_MAX_MS
        || !marker
        || typeof marker !== 'object'
        || typeof (marker as { dataVersion?: unknown }).dataVersion !== 'string'
        || (marker as { dataVersion: string }).dataVersion === ''
        || typeof (marker as { pointerKey?: unknown }).pointerKey !== 'string'
        || !Array.isArray((marker as { resourceKeys?: unknown }).resourceKeys)
      ) {
        throw new Error('Invalid cache staging marker.')
      }
      const typedMarker = marker as StagingMarker
      if (
        normalizeManifestIdentity(markerKey.rootIdentity) !== markerKey.rootIdentity
        || typedMarker.pointerKey !== familyPointerCacheKey(markerKey.rootIdentity, markerKey.family)
        || typedMarker.resourceKeys.length === 0
        || new Set(typedMarker.resourceKeys).size !== typedMarker.resourceKeys.length
      ) {
        throw new Error('Cache staging marker namespace mismatch.')
      }
      const resourcePrefix = `@family-snapshot/${markerKey.family}/${markerKey.generation}/`
      for (const resourceKey of typedMarker.resourceKeys) {
        if (typeof resourceKey !== 'string') {
          throw new Error('Invalid staged resource key.')
        }
        const parsedResource = parseResourceKey(resourceKey)
        if (
          !parsedResource
          || parsedResource.rootIdentity !== markerKey.rootIdentity
          || parsedResource.dataVersion !== typedMarker.dataVersion
          || !parsedResource.resource.startsWith(resourcePrefix)
        ) {
          throw new Error('Staged resource key escaped its generation namespace.')
        }
        protectedKeys.add(cacheStorageKey(resourceKey))
      }
      protectedKeys.add(entry.key)
    } catch {
      invalidMarkerKeys.add(entry.key)
    }
  }
  return { invalidMarkerKeys, protectedKeys }
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
    const entries = namespaceEntries(storage)
    const pointerProtection = validPointerBackingKeys(entries, now)
    const stagingProtection = validStagingBackingKeys(entries, now)
    const protectedKeys = new Set([
      ...pointerProtection.protectedKeys,
      ...stagingProtection.protectedKeys,
    ])
    for (const key of options.protectKeys ?? []) {
      protectedKeys.add(cacheStorageKey(key))
    }
    const cleanupProtectedKeys = new Set(protectedKeys)
    for (const key of options.transientProtectKeys ?? []) {
      cleanupProtectedKeys.add(cacheStorageKey(key))
    }

    const removeKeys = new Set([
      ...pointerProtection.invalidPointerKeys,
      ...stagingProtection.invalidMarkerKeys,
    ])
    for (const entry of entries) {
      const parsed = parseStoredEntry(entry.key, entry.raw)
      if (
        !parsed
        || now - parsed.savedAtMs < 0
        || now - parsed.savedAtMs > CACHE_MAX_STALE_MS
      ) {
        if (!cleanupProtectedKeys.has(entry.key)) {
          removeKeys.add(entry.key)
        }
      }
    }

    for (const entry of entries) {
      if (removeKeys.has(entry.key) || cleanupProtectedKeys.has(entry.key)) {
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
        removeKeys.add(entry.key)
      }
    }

    let totalBytes = entries.reduce(
      (total, entry) => total + storedBytes(entry.key, entry.raw),
      0,
    )
    const removedKeys = new Set<string>()
    const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]))
    for (const key of removeKeys) {
      const entry = entriesByKey.get(key)
      if (!entry) {
        continue
      }
      try {
        storage.removeItem(key)
        removedKeys.add(key)
        totalBytes -= storedBytes(entry.key, entry.raw)
      } catch {
        // Cleanup is best effort. Failed removals still count toward the cap.
      }
    }

    const reserveBytes = Number.isSafeInteger(options.reserveBytes) && (options.reserveBytes ?? 0) > 0
      ? options.reserveBytes as number
      : 0
    const targetBytes = Math.max(0, CACHE_NAMESPACE_MAX_BYTES - reserveBytes)
    if (totalBytes <= targetBytes) {
      return
    }

    const evictableLeaves = entries
      .filter((entry) => (
        !removedKeys.has(entry.key)
        && !protectedKeys.has(entry.key)
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

function serializeEnvelope(value: unknown, savedAt = new Date().toISOString()): string | null {
  try {
    return JSON.stringify({ savedAt, value } satisfies CacheEnvelope<unknown>)
  } catch {
    return null
  }
}

function replacedStorageBytes(storage: Storage, storageKey: string): { previous: string | null; replacedBytes: number } {
  try {
    const previous = storage.getItem(storageKey)
    return {
      previous,
      replacedBytes: previous === null ? 0 : storedBytes(storageKey, previous),
    }
  } catch {
    return { previous: null, replacedBytes: 0 }
  }
}

export function saveCache<T>(key: string, value: T, options: SaveCacheOptions = {}): boolean {
  const storage = localStorageOrNull()
  if (!storage) {
    return false
  }

  const serialized = serializeEnvelope(value)
  if (serialized === null) {
    return false
  }

  const storageKey = cacheStorageKey(key)
  if (storedBytes(storageKey, serialized) > CACHE_NAMESPACE_MAX_BYTES) {
    return false
  }
  const protectedKeys = [...options.protectKeys ?? []]
  const { replacedBytes } = replacedStorageBytes(storage, storageKey)
  const pendingBytes = Math.max(0, storedBytes(storageKey, serialized) - replacedBytes)
  sweepCache({
    currentDataVersion: options.currentDataVersion,
    protectKeys: [...protectedKeys, key],
    reserveBytes: pendingBytes,
  })

  try {
    storage.setItem(storageKey, serialized)
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
      return true
    } catch {
      return false
    }
  }
}

interface PreparedBatchWrite {
  key: string
  previous: string | null
  raw: string
  storageKey: string
}

function restoreBatchWrites(storage: Storage, writes: readonly PreparedBatchWrite[]): void {
  for (const write of [...writes].reverse()) {
    try {
      if (write.previous === null) {
        storage.removeItem(write.storageKey)
      } else {
        storage.setItem(write.storageKey, write.previous)
      }
    } catch {
      // Web Storage writes are atomic. Restoration is a final best-effort guard
      // for mocked or non-conforming implementations that mutate before throw.
    }
  }
}

function validFamilyBatch(
  writes: readonly CacheBatchWrite[],
  options: CommitCacheBatchOptions,
): boolean {
  const { family, generation, rootManifestUrl } = options.staging
  if (!snapshotGenerationPattern.test(generation) || writes.length !== 2) {
    return false
  }
  const expectedPointerKey = familyPointerCacheKey(rootManifestUrl, family)
  if (options.pointer.key !== expectedPointerKey) {
    return false
  }
  const pointer = options.pointer.value
  if (
    !pointer
    || typeof pointer !== 'object'
    || (pointer as { dataVersion?: unknown }).dataVersion !== options.currentDataVersion
    || (pointer as { generation?: unknown }).generation !== generation
    || typeof (pointer as { rootKey?: unknown }).rootKey !== 'string'
    || typeof (pointer as { childKey?: unknown }).childKey !== 'string'
    || typeof (pointer as { rootUrl?: unknown }).rootUrl !== 'string'
    || typeof (pointer as { childUrl?: unknown }).childUrl !== 'string'
    || normalizeManifestIdentity((pointer as { rootUrl: string }).rootUrl)
      !== normalizeManifestIdentity(rootManifestUrl)
  ) {
    return false
  }
  const pointerKeys = new Set([
    (pointer as { rootKey: string }).rootKey,
    (pointer as { childKey: string }).childKey,
  ])
  if (pointerKeys.size !== 2 || writes.some((write) => !pointerKeys.has(write.key))) {
    return false
  }
  const rootIdentity = normalizeManifestIdentity(rootManifestUrl)
  const resourcePrefix = `@family-snapshot/${family}/${generation}/`
  return writes.every((write) => {
    const parsed = parseResourceKey(write.key)
    return Boolean(
      parsed
      && parsed.rootIdentity === rootIdentity
      && parsed.dataVersion === options.currentDataVersion
      && parsed.resource.startsWith(resourcePrefix),
    )
  })
}

/**
 * Commits a complete family snapshot. The short-lived marker lets a sweep in
 * another tab distinguish in-progress backing entries from abandoned orphans.
 * The pointer is always the final write, so readers see either complete
 * generation even when staging or quota recovery fails.
 */
export function commitCacheBatch(
  writes: readonly CacheBatchWrite[],
  options: CommitCacheBatchOptions,
): boolean {
  const storage = localStorageOrNull()
  if (!storage) {
    return false
  }
  try {
    if (!validFamilyBatch(writes, options)) {
      return false
    }
  } catch {
    return false
  }

  const markerKey = familyStagingCacheKey(
    options.staging.rootManifestUrl,
    options.staging.family,
    options.staging.generation,
  )
  const savedAt = new Date().toISOString()
  const marker: StagingMarker = {
    dataVersion: options.currentDataVersion,
    pointerKey: options.pointer.key,
    resourceKeys: writes.map((write) => write.key),
  }
  const orderedWrites: CacheBatchWrite[] = [
    { key: markerKey, value: marker },
    ...writes,
    options.pointer,
  ]
  const prepared: PreparedBatchWrite[] = []
  try {
    for (const write of orderedWrites) {
      const raw = serializeEnvelope(write.value, savedAt)
      if (raw === null) {
        return false
      }
      const storageKey = cacheStorageKey(write.key)
      prepared.push({
        key: write.key,
        previous: storage.getItem(storageKey),
        raw,
        storageKey,
      })
    }
  } catch {
    return false
  }

  const committedBytes = prepared.slice(1).reduce(
    (total, write) => total + storedBytes(write.storageKey, write.raw),
    0,
  )
  if (committedBytes > CACHE_NAMESPACE_MAX_BYTES) {
    return false
  }

  const reserveBytes = prepared.reduce((total, write) => (
    total + Math.max(
      0,
      storedBytes(write.storageKey, write.raw)
        - (write.previous === null ? 0 : storedBytes(write.storageKey, write.previous)),
    )
  ), 0)
  const protectKeys = prepared.map((write) => write.key)
  const sweepForAttempt = () => sweepCache({
    currentDataVersion: options.currentDataVersion,
    protectKeys,
    reserveBytes,
  })
  const attempt = (): unknown | null => {
    const changed: PreparedBatchWrite[] = []
    try {
      for (const write of prepared) {
        changed.push(write)
        storage.setItem(write.storageKey, write.raw)
      }
    } catch (error) {
      restoreBatchWrites(storage, changed)
      return error
    }
    try {
      storage.removeItem(cacheStorageKey(markerKey))
    } catch {
      // A live marker is harmless and expires after CACHE_STAGING_MAX_MS.
    }
    return null
  }

  sweepForAttempt()
  let failure = attempt()
  if (failure !== null) {
    if (options.retryQuota === false || !isQuotaError(failure)) {
      return false
    }
    sweepForAttempt()
    failure = attempt()
    if (failure !== null) {
      return false
    }
  }

  sweepCache({ currentDataVersion: options.currentDataVersion })
  return true
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
