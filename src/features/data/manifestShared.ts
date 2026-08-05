import { loadCache, removeCache, resourceCacheKey, saveCache } from './cacheStore'
import type { CacheEntry } from './cacheStore'
import type { LoadResult } from './types'
import { dataRequestTimeoutReason } from './dataRequestTimeout'
import { abortReason, isAbortError } from './requestAbort'
import { createSharedResourceStore } from './sharedResourceStore'

export interface ResolvedLoadResult<T> extends LoadResult<T> {
  url: string
}

export interface VersionedLoadOptions {
  expectedDataVersion: string
  signal?: AbortSignal
}

export type AssertFn<T> = (value: unknown) => asserts value is T

const versionedResourceStore = createSharedResourceStore<ResolvedLoadResult<unknown>>()

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

export function assertVersion(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} dataVersion ${actual} did not match expected ${expected}.`)
  }
}

export { abortReason, isAbortError } from './requestAbort'

export async function fetchJson<T>(
  url: string,
  assertValue: AssertFn<T>,
  options: { cache: RequestCache; requestLabel?: string; signal?: AbortSignal },
): Promise<T> {
  if (options.signal?.aborted) {
    throw abortReason(options.signal)
  }
  const response = await fetch(url, {
    cache: options.cache,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) {
    throw new Error(`${options.requestLabel ?? 'Request'} failed with ${response.status}.`)
  }
  const value: unknown = await response.json()
  assertValue(value)
  return value
}

export function fallbackWarning(
  label: string,
  entry: Pick<CacheEntry<unknown>, 'freshness' | 'savedAt'>,
): string {
  return entry.freshness === 'stale'
    ? `최신 ${label}을 불러오지 못해 ${entry.savedAt}의 오래된 캐시 snapshot을 사용 중입니다.`
    : `최신 ${label}을 불러오지 못해 ${entry.savedAt} 캐시를 사용 중입니다.`
}

interface VersionedResourceConfig<T> {
  assertValue: AssertFn<T>
  checkValue?: (value: T) => void
  dedupeKeySuffix?: string
  label: string
  manifestUrl: string
  options: VersionedLoadOptions
  resourcePath: string
  requestCache?: RequestCache
  requestLabel?: string
  versionedLeaf?: boolean
}

export async function loadVersionedResource<T>(
  config: VersionedResourceConfig<T>,
): Promise<ResolvedLoadResult<T>> {
  const { expectedDataVersion, signal } = config.options
  if (!expectedDataVersion) {
    throw new Error(`Expected dataVersion is required for ${config.label}.`)
  }
  const url = config.versionedLeaf
    ? resolveVersionedLeafUrl(config.manifestUrl, config.resourcePath, expectedDataVersion)
    : resolveDataUrl(config.manifestUrl, config.resourcePath)
  const cacheKey = resourceCacheKey(config.manifestUrl, expectedDataVersion, config.resourcePath)
  try {
    const data = await fetchJson(url, config.assertValue, {
      cache: config.requestCache ?? 'no-cache',
      ...(config.requestLabel ? { requestLabel: config.requestLabel } : {}),
      ...(signal ? { signal } : {}),
    })
    config.checkValue?.(data)
    saveCache(cacheKey, data, { currentDataVersion: expectedDataVersion })
    return { data, source: 'network', url }
  } catch (error) {
    const timeoutError = dataRequestTimeoutReason(signal)
    if (!timeoutError && (isAbortError(error) || signal?.aborted)) {
      throw error
    }
    const cached = loadCache<unknown>(cacheKey)
    if (!cached) {
      throw timeoutError ?? error
    }
    try {
      config.assertValue(cached.value)
      config.checkValue?.(cached.value)
    } catch {
      removeCache(cacheKey)
      throw timeoutError ?? error
    }
    return {
      data: cached.value,
      source: 'cache',
      url,
      warning: fallbackWarning(config.label, cached),
    }
  }
}

export function fetchVersionedResource<T>(config: VersionedResourceConfig<T>): Promise<ResolvedLoadResult<T>> {
  const key = `resource:${resourceCacheKey(
    config.manifestUrl,
    config.options.expectedDataVersion,
    config.resourcePath,
  )}:${config.dedupeKeySuffix ?? ''}`
  return versionedResourceStore.acquire(key, {
    signal: config.options.signal,
    load: (signal) => loadVersionedResource({
      ...config,
      options: { ...config.options, signal },
    }),
  }) as Promise<ResolvedLoadResult<T>>
}
