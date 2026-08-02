import { loadCache, removeCache, resourceCacheKey, saveCache } from './cacheStore'
import type { CacheEntry } from './cacheStore'
import type { LoadResult } from './types'

export interface ResolvedLoadResult<T> extends LoadResult<T> {
  url: string
}

export interface VersionedLoadOptions {
  expectedDataVersion: string
  signal?: AbortSignal
}

export type AssertFn<T> = (value: unknown) => asserts value is T

const pendingLoads = new Map<string, Promise<unknown>>()

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

export function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

export function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) {
    return signal.reason
  }
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

export async function fetchJson<T>(
  url: string,
  assertValue: AssertFn<T>,
  options: { cache: RequestCache; signal?: AbortSignal },
): Promise<T> {
  if (options.signal?.aborted) {
    throw abortReason(options.signal)
  }
  const response = await fetch(url, {
    cache: options.cache,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}.`)
  }
  const value: unknown = await response.json()
  assertValue(value)
  return value
}

export function withDedupe<T>(
  key: string,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
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
  versionedLeaf?: boolean
}

export async function fetchVersionedResource<T>(
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
  const operation = async (): Promise<ResolvedLoadResult<T>> => {
    try {
      const data = await fetchJson(url, config.assertValue, {
        cache: 'no-cache',
        ...(signal ? { signal } : {}),
      })
      config.checkValue?.(data)
      saveCache(cacheKey, data, { currentDataVersion: expectedDataVersion })
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
