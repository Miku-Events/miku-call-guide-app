import {
  familyPointerCacheKey,
  loadCache,
  normalizeManifestIdentity,
  removeCache,
  resourceCacheKey,
  saveCache,
  sweepCache,
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
  withDedupe,
  type AssertFn,
  type ResolvedLoadResult,
} from './manifestShared'
import type { RootManifest } from './types'

export type FamilyName = 'call-guide' | 'event-calendar'

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
  signal?: AbortSignal
}

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
  if (!saveCache(rootKey, root, {
    currentDataVersion: root.dataVersion,
    protectKeys: [rootKey],
  })) {
    return
  }
  if (!saveCache(childKey, child, {
    currentDataVersion: root.dataVersion,
    protectKeys: [rootKey, childKey],
  })) {
    removeCache(rootKey)
    return
  }
  const pointerKey = familyPointerCacheKey(rootManifestUrl, config.family)
  const pointerSaved = saveCache<FamilyPointer>(pointerKey, {
    childKey,
    childUrl,
    dataVersion: root.dataVersion,
    generation,
    rootKey,
    rootUrl: rootManifestUrl,
  }, {
    currentDataVersion: root.dataVersion,
    protectKeys: [pointerKey, rootKey, childKey],
  })
  if (!pointerSaved) {
    removeCache(rootKey)
    removeCache(childKey)
    return
  }

  sweepCache({ currentDataVersion: root.dataVersion })
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

type SettledChild<T> =
  | { ok: true; value: T }
  | { error: unknown; ok: false }

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) {
    return () => undefined
  }
  if (source.aborted) {
    target.abort(abortReason(source))
    return () => undefined
  }
  const abort = () => target.abort(abortReason(source))
  source.addEventListener('abort', abort, { once: true })
  return () => source.removeEventListener('abort', abort)
}

async function networkFamily<T extends { dataVersion: string }>(
  rootManifestUrl: string,
  config: FamilyConfig<T>,
  signal: AbortSignal | undefined,
): Promise<ResolvedLoadResult<T>> {
  const rootPromise = fetchJson(rootManifestUrl, config.assertRoot, {
    cache: 'no-cache',
    ...(signal ? { signal } : {}),
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
        signal: speculativeController.signal,
      }).then(
        (value): SettledChild<T> => ({ ok: true, value }),
        (error: unknown): SettledChild<T> => ({ error, ok: false }),
      )
    : null
  let completed = false

  try {
    const root = await rootPromise
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
        if (signal?.aborted) {
          throw abortReason(signal)
        }
        child = await fetchJson(childUrl, config.assertChild, {
          cache: 'no-cache',
          ...(signal ? { signal } : {}),
        })
      }
    } else {
      speculativeController?.abort(new DOMException('Speculative child was not declared by root.', 'AbortError'))
      child = await fetchJson(childUrl, config.assertChild, {
        cache: 'no-cache',
        ...(signal ? { signal } : {}),
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
        signal?.aborted
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
  const dedupeKey = `family:${familyPointerCacheKey(rootManifestUrl, config.family)}`
  return withDedupe(dedupeKey, options.signal, async () => {
    try {
      return await networkFamily(rootManifestUrl, config, options.signal)
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) {
        throw error
      }
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

export async function fetchRootManifestWithValidator(
  rootManifestUrl: string,
  assertRoot: AssertFn<RootManifest>,
  options: ManifestLoadOptions = {},
): Promise<ResolvedLoadResult<RootManifest>> {
  if (!rootManifestUrl) {
    throw new Error('VITE_DATA_MANIFEST_URL is not configured.')
  }
  const root = await withDedupe(
    `root:${normalizeManifestIdentity(rootManifestUrl)}`,
    options.signal,
    () => fetchJson(rootManifestUrl, assertRoot, {
      cache: 'no-cache',
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  )
  return { data: root, source: 'network', url: rootManifestUrl }
}
