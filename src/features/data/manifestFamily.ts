import {
  commitFamilySnapshot,
  familyPointerCacheKey,
  loadCache,
  normalizeManifestIdentity,
  resourceCacheKey,
  type CacheEntry,
  type CacheFreshness,
} from './cacheStore'
import {
  abortReason,
  assertVersion,
  fallbackWarning,
  fetchJson,
  isAbortError,
  resolveDataUrl,
  type AssertFn,
  type ResolvedLoadResult,
  JSON_BYTE_LIMITS,
} from './manifestShared'
import type { RootManifest } from './types'
import {
  CALL_GUIDE_LOAD_DEADLINE_MS,
  DataRequestTimeoutError,
  dataRequestTimeoutReason,
} from './dataRequestTimeout'
import { forwardAbort } from './requestAbort'
import { createSharedResourceStore } from './sharedResourceStore'

type FamilyName = 'call-guide' | 'event-calendar'

interface FamilyPointer {
  childKey: string
  childUrl: string
  dataVersion: string
  generation?: string
  rootKey: string
  rootUrl: string
}

export interface FamilyConfig<T extends { dataVersion: string }> {
  assertChild: AssertFn<T>
  assertRoot: AssertFn<RootManifest>
  childPath: (root: RootManifest) => string
  family: FamilyName
  label: string
  maxBytes?: number
  speculativeChildPath?: string
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

export interface ManifestLoadOptions {
  force?: boolean
  retain?: boolean
  signal?: AbortSignal
}

const rootManifestStore = createSharedResourceStore<RootManifest>({
  completedLimit: Number.MAX_SAFE_INTEGER,
  deadline: {
    error: () => new DataRequestTimeoutError('manifest'),
    timeoutMs: CALL_GUIDE_LOAD_DEADLINE_MS,
  },
})
const callGuideFamilyStore = createSharedResourceStore<ResolvedLoadResult<{ dataVersion: string }>>({
  completedLimit: 0,
  deadline: {
    error: () => new DataRequestTimeoutError('manifest'),
    timeoutMs: CALL_GUIDE_LOAD_DEADLINE_MS,
  },
})
const eventCalendarFamilyStore = createSharedResourceStore<ResolvedLoadResult<{ dataVersion: string }>>({
  completedLimit: 0,
  deadline: {
    error: () => new DataRequestTimeoutError('resource'),
    timeoutMs: CALL_GUIDE_LOAD_DEADLINE_MS,
  },
})

const snapshotGenerationPattern = /^[a-f0-9]{32}$/

function combinedFreshness(...entries: Array<CacheEntry<unknown>>): CacheFreshness {
  return entries.some((entry) => entry.freshness === 'stale') ? 'stale' : 'fresh'
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
  const pointerKey = familyPointerCacheKey(rootManifestUrl, config.family)
  commitFamilySnapshot({
    root: { key: rootKey, value: root },
    child: { key: childKey, value: child },
    currentDataVersion: root.dataVersion,
    pointer: {
      key: pointerKey,
      value: {
        childKey,
        childUrl,
        dataVersion: root.dataVersion,
        generation,
        rootKey,
        rootUrl: rootManifestUrl,
      } satisfies FamilyPointer,
    },
    staging: {
      family: config.family,
      generation,
      rootManifestUrl,
    },
  })
}

function sameFamilyPointer(
  left: CacheEntry<FamilyPointer>,
  right: CacheEntry<FamilyPointer>,
): boolean {
  const leftPointer = left.value as FamilyPointer | null | undefined
  const rightPointer = right.value as FamilyPointer | null | undefined
  return left.savedAt === right.savedAt
    && leftPointer?.childKey === rightPointer?.childKey
    && leftPointer?.childUrl === rightPointer?.childUrl
    && leftPointer?.dataVersion === rightPointer?.dataVersion
    && leftPointer?.generation === rightPointer?.generation
    && leftPointer?.rootKey === rightPointer?.rootKey
    && leftPointer?.rootUrl === rightPointer?.rootUrl
}

function loadFamilyFromPointer<T extends { dataVersion: string }>(
  rootManifestUrl: string,
  config: FamilyConfig<T>,
  pointerEntry: CacheEntry<FamilyPointer>,
): CachedFamily<T> | null {
  try {
    const pointer = pointerEntry.value
    if (
      !pointer
      || typeof pointer !== 'object'
      || typeof pointer.dataVersion !== 'string'
      || typeof pointer.rootKey !== 'string'
      || typeof pointer.childKey !== 'string'
      || typeof pointer.rootUrl !== 'string'
      || typeof pointer.childUrl !== 'string'
      || (Object.hasOwn(pointer, 'generation') && (
        typeof pointer.generation !== 'string'
        || !snapshotGenerationPattern.test(pointer.generation)
      ))
      || normalizeManifestIdentity(pointer.rootUrl) !== normalizeManifestIdentity(rootManifestUrl)
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
    config.assertRoot(rootEntry.value)
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

function loadCompleteFamily<T extends { dataVersion: string }>(
  rootManifestUrl: string,
  config: FamilyConfig<T>,
  expectedDataVersion?: string,
): CachedFamily<T> | null {
  const pointerKey = familyPointerCacheKey(rootManifestUrl, config.family)
  let pointerEntry = loadCache<FamilyPointer>(pointerKey)
  for (let attempt = 0; attempt < 2 && pointerEntry; attempt += 1) {
    const cached = pointerEntry.value?.dataVersion === expectedDataVersion || expectedDataVersion === undefined
      ? loadFamilyFromPointer(rootManifestUrl, config, pointerEntry)
      : null
    const latestPointer = loadCache<FamilyPointer>(pointerKey)
    if (!latestPointer) {
      return null
    }
    if (sameFamilyPointer(pointerEntry, latestPointer)) {
      return cached
    }
    pointerEntry = latestPointer
  }
  return null
}

type SettledChild<T> =
  | { ok: true; value: T }
  | { error: unknown; ok: false }

async function networkFamily<T extends { dataVersion: string }>(
  rootManifestUrl: string,
  config: FamilyConfig<T>,
  signal: AbortSignal,
  onRootDataVersion: (dataVersion: string) => void,
): Promise<ResolvedLoadResult<T>> {
  const rootPromise = rootManifestStore.acquire(normalizeManifestIdentity(rootManifestUrl), {
    force: true,
    signal,
    load: (rootSignal) => fetchJson(rootManifestUrl, config.assertRoot, {
      cache: 'no-cache',
      maxBytes: JSON_BYTE_LIMITS.rootManifest,
      signal: rootSignal,
      timeoutKind: 'manifest',
    }),
  })

  const speculativePath = config.speculativeChildPath
  const speculativeUrl = speculativePath
    ? resolveDataUrl(rootManifestUrl, speculativePath)
    : null
  const speculativeController = speculativeUrl ? new AbortController() : null
  const unlinkAbort = speculativeController
    ? forwardAbort(signal, speculativeController)
    : () => undefined
  const speculative = speculativeUrl && speculativeController
    ? fetchJson(speculativeUrl, config.assertChild, {
        cache: 'no-cache',
        maxBytes: config.maxBytes ?? JSON_BYTE_LIMITS.aggregate,
        signal: speculativeController.signal,
        timeoutKind: 'manifest',
      }).then(
        (value): SettledChild<T> => ({ ok: true, value }),
        (error: unknown): SettledChild<T> => ({ error, ok: false }),
      )
    : null
  let completed = false

  try {
    const root = await rootPromise
    onRootDataVersion(root.dataVersion)
    const childPath = config.childPath(root)
    const childUrl = resolveDataUrl(rootManifestUrl, childPath)
    let child: T

    if (speculative && childUrl === speculativeUrl) {
      const firstAttempt = await speculative
      if (!firstAttempt.ok) {
        throw firstAttempt.error
      }
      if (firstAttempt.value.dataVersion === root.dataVersion) {
        child = firstAttempt.value
      } else {
        if (signal.aborted) {
          throw abortReason(signal)
        }
        child = await fetchJson(childUrl, config.assertChild, {
          cache: 'no-cache',
          maxBytes: config.maxBytes ?? JSON_BYTE_LIMITS.aggregate,
          signal,
          timeoutKind: 'manifest',
        })
      }
    } else {
      speculativeController?.abort(new DOMException('Speculative child was not declared by root.', 'AbortError'))
      child = await fetchJson(childUrl, config.assertChild, {
        cache: 'no-cache',
        maxBytes: config.maxBytes ?? JSON_BYTE_LIMITS.aggregate,
        signal,
        timeoutKind: 'manifest',
      })
    }

    assertVersion(child.dataVersion, root.dataVersion, config.label)
    saveCompleteFamily(rootManifestUrl, root, childUrl, childPath, child, config)
    completed = true
    return { data: child, source: 'network', url: childUrl }
  } finally {
    unlinkAbort()
    if (!completed && !speculativeController?.signal.aborted) {
      speculativeController?.abort(
        signal.aborted
          ? abortReason(signal)
          : new DOMException('Manifest family load did not complete.', 'AbortError'),
      )
    }
  }
}

export function fetchManifestFamily<T extends { dataVersion: string }>(
  rootManifestUrl: string,
  config: FamilyConfig<T>,
  options: ManifestLoadOptions = {},
): Promise<ResolvedLoadResult<T>> {
  if (!rootManifestUrl) {
    return Promise.reject(new Error('VITE_DATA_MANIFEST_URL is not configured.'))
  }
  const key = `family:${familyPointerCacheKey(rootManifestUrl, config.family)}`
  const store = config.family === 'call-guide' ? callGuideFamilyStore : eventCalendarFamilyStore
  return store.acquire(key, {
    force: options.force,
    retain: options.retain,
    signal: options.signal,
    load: async (signal) => {
      let networkDataVersion: string | undefined
      try {
        return await networkFamily(rootManifestUrl, config, signal, (dataVersion) => {
          networkDataVersion = dataVersion
        })
      } catch (error) {
        const timeoutError = dataRequestTimeoutReason(signal)
        if (!timeoutError && (isAbortError(error) || signal.aborted)) {
          throw error
        }
        const cached = loadCompleteFamily(rootManifestUrl, config, networkDataVersion)
        if (!cached) {
          throw timeoutError ?? error
        }
        return {
          data: cached.data,
          source: 'cache',
          url: cached.url,
          warning: fallbackWarning(`${config.label} family`, cached),
        }
      }
    },
  }) as Promise<ResolvedLoadResult<T>>
}

export async function fetchRootManifestWithValidator(
  rootManifestUrl: string,
  assertRoot: AssertFn<RootManifest>,
  options: ManifestLoadOptions = {},
): Promise<ResolvedLoadResult<RootManifest>> {
  if (!rootManifestUrl) {
    throw new Error('VITE_DATA_MANIFEST_URL is not configured.')
  }
  const root = await rootManifestStore.acquire(normalizeManifestIdentity(rootManifestUrl), {
    force: options.force,
    retain: options.retain,
    signal: options.signal,
    load: (signal) => fetchJson(rootManifestUrl, assertRoot, {
      cache: 'no-cache',
      maxBytes: JSON_BYTE_LIMITS.rootManifest,
      signal,
      timeoutKind: 'manifest',
    }),
  })
  return { data: root, source: 'network', url: rootManifestUrl }
}

export function resetManifestSessionForTests(): void {
  callGuideFamilyStore.reset()
  eventCalendarFamilyStore.reset()
  rootManifestStore.reset()
}
