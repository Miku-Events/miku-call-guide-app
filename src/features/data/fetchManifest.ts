import {
  validateCallGuideManifest,
  validateEventCalendarIndex,
  validateEventCalendarMonth,
  validateRootManifest,
  validateRuntimeEvent,
} from '../../../data-contracts/validators.mjs'
import {
  familyPointerCacheKey,
  loadCache,
  normalizeManifestIdentity,
  removeCache,
  resourceCacheKey,
  saveCache,
  type CacheEntry,
  type CacheFreshness,
} from './cacheStore'
import { assertContract } from './contractValidation'
import type {
  CallGuideManifest,
  EventCalendarIndex,
  EventCalendarMonth,
  EventGuide,
  LoadResult,
  RootManifest,
} from './types'

interface ResolvedLoadResult<T> extends LoadResult<T> {
  url: string
}

export interface VersionedLoadOptions {
  expectedDataVersion: string
  signal?: AbortSignal
}

type AssertFn<T> = (value: unknown) => asserts value is T
type FamilyName = 'call-guide' | 'event-calendar'

interface FamilyPointer {
  childKey: string
  childUrl: string
  dataVersion: string
  generation?: string
  rootKey: string
  rootUrl: string
}

interface FamilyConfig<T extends { dataVersion: string }> {
  assertChild: AssertFn<T>
  childPath: (root: RootManifest) => string
  family: FamilyName
  label: string
}

interface CachedFamily<T extends { dataVersion: string }> {
  childKey: string
  data: T
  freshness: CacheFreshness
  generation?: string
  rootKey: string
  savedAt: string
  url: string
}

const pendingLoads = new Map<string, Promise<unknown>>()
const snapshotGenerationPattern = /^[a-f0-9]{32}$/

export function resolveDataUrl(baseUrl: string, relativePath: string): string {
  return new URL(relativePath, baseUrl).toString()
}

export function resolveVersionedLeafUrl(
  baseUrl: string,
  relativePath: string,
  dataVersion: string,
): string {
  const url = new URL(relativePath, baseUrl)
  url.searchParams.set('_miku_data_version', dataVersion)
  return url.toString()
}

function assertRootManifest(value: unknown): asserts value is RootManifest {
  assertContract(value, validateRootManifest, 'Root manifest response')
}

function assertCallGuideManifest(value: unknown): asserts value is CallGuideManifest {
  assertContract(value, validateCallGuideManifest, 'Call guide manifest response')
}

function assertEventCalendarIndex(value: unknown): asserts value is EventCalendarIndex {
  assertContract(value, validateEventCalendarIndex, 'Event calendar index response')
}

function assertEventCalendarMonth(value: unknown): asserts value is EventCalendarMonth {
  assertContract(value, validateEventCalendarMonth, 'Event calendar month response')
}

function assertEventGuide(value: unknown): asserts value is EventGuide {
  assertContract(value, validateRuntimeEvent, 'Event detail response')
}

function assertVersion(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} dataVersion ${actual} did not match expected ${expected}.`)
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) {
    return signal.reason
  }
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

async function fetchJson<T>(url: string, assertValue: AssertFn<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw abortReason(signal)
  }
  const response = await fetch(url, { cache: 'no-cache', ...(signal ? { signal } : {}) })
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}.`)
  }
  const value: unknown = await response.json()
  assertValue(value)
  return value
}

function withDedupe<T>(key: string, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  if (signal) {
    return operation()
  }
  const existing = pendingLoads.get(key) as Promise<T> | undefined
  if (existing) {
    return existing
  }
  const pending = operation().finally(() => {
    pendingLoads.delete(key)
  })
  pendingLoads.set(key, pending)
  return pending
}

function combinedFreshness(...entries: Array<CacheEntry<unknown>>): CacheFreshness {
  return entries.some((entry) => entry.freshness === 'stale') ? 'stale' : 'fresh'
}

function fallbackWarning(label: string, entry: Pick<CacheEntry<unknown>, 'freshness' | 'savedAt'>): string {
  return entry.freshness === 'stale'
    ? `최신 ${label}을 불러오지 못해 ${entry.savedAt}의 오래된 캐시 snapshot을 사용 중입니다.`
    : `최신 ${label}을 불러오지 못해 ${entry.savedAt} 캐시를 사용 중입니다.`
}

function createSnapshotGeneration(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function familySnapshotResourceKey(
  rootManifestUrl: string,
  dataVersion: string,
  family: FamilyName,
  generation: string,
  resource: string,
): string {
  return resourceCacheKey(
    rootManifestUrl,
    dataVersion,
    `@family-snapshot/${family}/${generation}/${resource}`,
  )
}

function familyRootCacheKey(
  rootManifestUrl: string,
  dataVersion: string,
  family: FamilyName,
  generation?: string,
): string {
  return generation
    ? familySnapshotResourceKey(rootManifestUrl, dataVersion, family, generation, 'root')
    : resourceCacheKey(rootManifestUrl, dataVersion, '@root')
}

function familyChildCacheKey(
  rootManifestUrl: string,
  dataVersion: string,
  childPath: string,
  family: FamilyName,
  generation?: string,
): string {
  return generation
    ? familySnapshotResourceKey(rootManifestUrl, dataVersion, family, generation, `child/${childPath}`)
    : resourceCacheKey(rootManifestUrl, dataVersion, childPath)
}

function saveCompleteFamily<T extends { dataVersion: string }>(
  rootManifestUrl: string,
  root: RootManifest,
  childUrl: string,
  childPath: string,
  child: T,
  config: FamilyConfig<T>,
): void {
  const previous = loadCompleteFamily(rootManifestUrl, config)
  const generation = createSnapshotGeneration()
  const rootKey = familyRootCacheKey(
    rootManifestUrl,
    root.dataVersion,
    config.family,
    generation,
  )
  const childKey = familyChildCacheKey(
    rootManifestUrl,
    root.dataVersion,
    childPath,
    config.family,
    generation,
  )
  if (!saveCache(rootKey, root)) {
    return
  }
  if (!saveCache(childKey, child)) {
    return
  }
  const pointerSaved = saveCache<FamilyPointer>(familyPointerCacheKey(rootManifestUrl, config.family), {
    childKey,
    childUrl,
    dataVersion: root.dataVersion,
    generation,
    rootKey,
    rootUrl: rootManifestUrl,
  })
  if (!pointerSaved || !previous?.generation) {
    return
  }

  const currentKeys = new Set([rootKey, childKey])
  for (const previousKey of new Set([previous.rootKey, previous.childKey])) {
    if (!currentKeys.has(previousKey)) {
      removeCache(previousKey)
    }
  }
}

function loadCompleteFamily<T extends { dataVersion: string }>(
  rootManifestUrl: string,
  config: FamilyConfig<T>,
): CachedFamily<T> | null {
  const pointerKey = familyPointerCacheKey(rootManifestUrl, config.family)
  const pointerEntry = loadCache<FamilyPointer>(pointerKey)
  if (!pointerEntry) {
    return null
  }

  try {
    const pointer = pointerEntry.value
    if (
      !pointer ||
      typeof pointer !== 'object' ||
      typeof pointer.dataVersion !== 'string' ||
      typeof pointer.rootKey !== 'string' ||
      typeof pointer.childKey !== 'string' ||
      typeof pointer.rootUrl !== 'string' ||
      typeof pointer.childUrl !== 'string' ||
      (Object.hasOwn(pointer, 'generation') && (
        typeof pointer.generation !== 'string'
        || !snapshotGenerationPattern.test(pointer.generation)
      )) ||
      normalizeManifestIdentity(pointer.rootUrl) !== normalizeManifestIdentity(rootManifestUrl)
    ) {
      throw new Error('Family pointer was invalid.')
    }

    const expectedRootKey = familyRootCacheKey(
      rootManifestUrl,
      pointer.dataVersion,
      config.family,
      pointer.generation,
    )
    if (pointer.rootKey !== expectedRootKey) {
      throw new Error('Family pointer root key did not match its namespace.')
    }
    const rootEntry = loadCache<unknown>(pointer.rootKey)
    if (!rootEntry) {
      throw new Error('Family snapshot was incomplete.')
    }
    assertRootManifest(rootEntry.value)
    assertVersion(rootEntry.value.dataVersion, pointer.dataVersion, 'Cached root manifest')
    const childPath = config.childPath(rootEntry.value)
    const expectedChildKey = familyChildCacheKey(
      rootManifestUrl,
      pointer.dataVersion,
      childPath,
      config.family,
      pointer.generation,
    )
    if (pointer.childKey !== expectedChildKey) {
      throw new Error('Family pointer child key did not match its namespace.')
    }
    const childEntry = loadCache<unknown>(pointer.childKey)
    if (!childEntry) {
      throw new Error('Family snapshot was incomplete.')
    }
    config.assertChild(childEntry.value)
    assertVersion(childEntry.value.dataVersion, pointer.dataVersion, `Cached ${config.label}`)
    const expectedChildUrl = resolveDataUrl(rootManifestUrl, childPath)
    if (expectedChildUrl !== pointer.childUrl) {
      throw new Error('Cached family child URL did not match its root manifest.')
    }
    return {
      childKey: pointer.childKey,
      data: childEntry.value,
      freshness: combinedFreshness(pointerEntry, rootEntry, childEntry),
      generation: pointer.generation,
      rootKey: pointer.rootKey,
      savedAt: pointerEntry.savedAt,
      url: pointer.childUrl,
    }
  } catch {
    return null
  }
}

async function fetchManifestFamily<T extends { dataVersion: string }>(
  rootManifestUrl: string,
  config: FamilyConfig<T>,
): Promise<ResolvedLoadResult<T>> {
  if (!rootManifestUrl) {
    throw new Error('VITE_DATA_MANIFEST_URL is not configured.')
  }
  const dedupeKey = `family:${familyPointerCacheKey(rootManifestUrl, config.family)}`
  return withDedupe(dedupeKey, undefined, async () => {
    try {
      const root = await fetchJson(rootManifestUrl, assertRootManifest)
      const childPath = config.childPath(root)
      const childUrl = resolveDataUrl(rootManifestUrl, childPath)
      const child = await fetchJson(childUrl, config.assertChild)
      assertVersion(child.dataVersion, root.dataVersion, config.label)
      saveCompleteFamily(rootManifestUrl, root, childUrl, childPath, child, config)
      return { data: child, source: 'network', url: childUrl }
    } catch (error) {
      const cached = loadCompleteFamily(rootManifestUrl, config)
      if (!cached) {
        throw error
      }
      return {
        data: cached.data,
        source: 'cache',
        url: cached.url,
        warning: fallbackWarning(`${config.label} family`, cached),
      }
    }
  })
}

export async function fetchRootManifest(rootManifestUrl: string): Promise<ResolvedLoadResult<RootManifest>> {
  if (!rootManifestUrl) {
    throw new Error('VITE_DATA_MANIFEST_URL is not configured.')
  }
  const root = await withDedupe(`root:${normalizeManifestIdentity(rootManifestUrl)}`, undefined, () =>
    fetchJson(rootManifestUrl, assertRootManifest),
  )
  return { data: root, source: 'network', url: rootManifestUrl }
}

export function fetchCallGuideManifest(rootManifestUrl: string): Promise<ResolvedLoadResult<CallGuideManifest>> {
  return fetchManifestFamily(rootManifestUrl, {
    assertChild: assertCallGuideManifest,
    childPath: (root) => root.manifests.callGuide,
    family: 'call-guide',
    label: 'call-guide manifest',
  })
}

export function fetchEventCalendarIndex(rootManifestUrl: string): Promise<ResolvedLoadResult<EventCalendarIndex>> {
  return fetchManifestFamily(rootManifestUrl, {
    assertChild: assertEventCalendarIndex,
    childPath: (root) => root.manifests.eventCalendar,
    family: 'event-calendar',
    label: 'event calendar index',
  })
}

interface VersionedResourceConfig<T> {
  assertValue: AssertFn<T>
  checkValue?: (value: T) => void
  dedupeKeySuffix?: string
  label: string
  manifestUrl: string
  options: VersionedLoadOptions
  resourcePath: string
  versionedLeaf?: boolean
}

async function fetchVersionedResource<T>(config: VersionedResourceConfig<T>): Promise<ResolvedLoadResult<T>> {
  const { expectedDataVersion, signal } = config.options
  if (!expectedDataVersion) {
    throw new Error(`Expected dataVersion is required for ${config.label}.`)
  }
  const url = config.versionedLeaf
    ? resolveVersionedLeafUrl(config.manifestUrl, config.resourcePath, expectedDataVersion)
    : resolveDataUrl(config.manifestUrl, config.resourcePath)
  const cacheKey = resourceCacheKey(config.manifestUrl, expectedDataVersion, config.resourcePath)
  const operation = async (): Promise<ResolvedLoadResult<T>> => {
    try {
      const data = await fetchJson(url, config.assertValue, signal)
      config.checkValue?.(data)
      saveCache(cacheKey, data)
      return { data, source: 'network', url }
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw error
      }
      const cached = loadCache<unknown>(cacheKey)
      if (!cached) {
        throw error
      }
      try {
        config.assertValue(cached.value)
        config.checkValue?.(cached.value)
      } catch {
        removeCache(cacheKey)
        throw error
      }
      return {
        data: cached.value,
        source: 'cache',
        url,
        warning: fallbackWarning(config.label, cached),
      }
    }
  }
  return withDedupe(`resource:${cacheKey}:${config.dedupeKeySuffix ?? ''}`, signal, operation)
}

export function fetchEventCalendarMonth(
  eventCalendarIndexUrl: string,
  month: string,
  options: VersionedLoadOptions,
): Promise<ResolvedLoadResult<EventCalendarMonth>> {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
    return Promise.reject(new Error(`Requested event calendar month was invalid: ${month}.`))
  }
  return fetchVersionedResource({
    assertValue: assertEventCalendarMonth,
    checkValue: (value) => {
      if (value.month !== month) {
        throw new Error(`Event calendar month ${value.month} did not match requested ${month}.`)
      }
      assertVersion(value.dataVersion, options.expectedDataVersion, 'Event calendar month')
    },
    label: `${month} event calendar`,
    manifestUrl: eventCalendarIndexUrl,
    options,
    resourcePath: `months/${month}.json`,
  })
}

export function fetchEventDetail(
  monthManifestUrl: string,
  eventPath: string,
  eventId: string,
  options: VersionedLoadOptions,
): Promise<ResolvedLoadResult<EventGuide>> {
  return fetchVersionedResource({
    assertValue: assertEventGuide,
    checkValue: (value) => {
      if (value.id !== eventId) {
        throw new Error(`Event detail id ${value.id} did not match requested ${eventId}.`)
      }
      assertVersion(value.dataVersion, options.expectedDataVersion, 'Event detail')
    },
    label: 'event detail',
    dedupeKeySuffix: eventId,
    manifestUrl: monthManifestUrl,
    options,
    resourcePath: eventPath,
    versionedLeaf: true,
  })
}

export const fetchManifest = fetchCallGuideManifest
