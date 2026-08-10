import { loadCache, removeCache, resourceCacheKey, saveCache } from './cacheStore'
import type { CacheEntry } from './cacheStore'
import type { LoadResult } from './types'
import {
  CALL_GUIDE_LOAD_DEADLINE_MS,
  DATA_REQUEST_TIMEOUT_MS,
  DataRequestTimeoutError,
  dataRequestTimeoutReason,
  type DataRequestKind,
} from './dataRequestTimeout'
import { abortReason, forwardAbort, isAbortError } from './requestAbort'
import { createSharedResourceStore } from './sharedResourceStore'

export interface ResolvedLoadResult<T> extends LoadResult<T> {
  url: string
}

export interface VersionedLoadOptions {
  expectedDataVersion: string
  signal?: AbortSignal
}

export type AssertFn<T> = (value: unknown) => asserts value is T

export const JSON_BYTE_LIMITS = {
  aggregate: 256 * 1024,
  eventDetail: 128 * 1024,
  rootManifest: 32 * 1024,
  song: 512 * 1024,
} as const

const versionedResourceStore = createSharedResourceStore<ResolvedLoadResult<unknown>>({
  deadline: {
    error: () => new DataRequestTimeoutError('resource'),
    timeoutMs: CALL_GUIDE_LOAD_DEADLINE_MS,
  },
})

function assertHttpUrl(url: URL, label: string): void {
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error(`${label} must be an HTTP(S) URL without credentials.`)
  }
}

export function resolveDataUrl(baseUrl: string, relativePath: string): string {
  const base = new URL(baseUrl)
  const resolved = new URL(relativePath, base)
  assertHttpUrl(base, 'Manifest URL')
  assertHttpUrl(resolved, 'Data resource URL')
  if (resolved.origin !== base.origin) {
    throw new Error('Data resource URL must use the manifest origin.')
  }
  return resolved.toString()
}

export function resolveVersionedLeafUrl(
  baseUrl: string,
  relativePath: string,
  dataVersion: string,
): string {
  const url = new URL(resolveDataUrl(baseUrl, relativePath))
  url.searchParams.set('_miku_data_version', dataVersion)
  return url.toString()
}

export function assertVersion(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} dataVersion ${actual} did not match expected ${expected}.`)
  }
}

export { abortReason, isAbortError } from './requestAbort'

function isNativeResponse(response: Response): boolean {
  return typeof Response !== 'undefined'
    && response instanceof Response
    && response.headers instanceof Headers
}

function assertJsonMediaType(response: Response, requestLabel: string): void {
  const contentType = response.headers.get('content-type')
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json' && !mediaType?.endsWith('+json')) {
    throw new Error(`${requestLabel} returned a non-JSON media type.`)
  }
}

function contentLength(response: Response, requestLabel: string): number | null {
  const raw = response.headers.get('content-length')
  if (raw === null) {
    return null
  }
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${requestLabel} returned an invalid Content-Length.`)
  }
  const length = Number(raw)
  if (!Number.isSafeInteger(length)) {
    throw new Error(`${requestLabel} returned an invalid Content-Length.`)
  }
  return length
}

async function readBoundedJson(
  response: Response,
  requestLabel: string,
  maxBytes: number,
): Promise<unknown> {
  assertJsonMediaType(response, requestLabel)
  const declaredLength = contentLength(response, requestLabel)
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new Error(`${requestLabel} exceeded the ${maxBytes}-byte response limit.`)
  }
  if (!response.body) {
    throw new Error(`${requestLabel} returned an empty response body.`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`${requestLabel} exceeded the ${maxBytes}-byte response limit.`)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`${requestLabel} was not valid UTF-8.`, { cause: error })
    }
    throw error
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${requestLabel} returned invalid JSON.`, { cause: error })
  }
}

export async function fetchJson<T>(
  url: string,
  assertValue: AssertFn<T>,
  options: {
    cache: RequestCache
    maxBytes: number
    requestLabel?: string
    signal?: AbortSignal
    timeoutKind?: DataRequestKind
  },
): Promise<T> {
  if (options.signal?.aborted) {
    throw abortReason(options.signal)
  }
  const requestUrl = new URL(url)
  assertHttpUrl(requestUrl, 'Data request URL')
  const requestLabel = options.requestLabel ?? 'Request'
  const controller = new AbortController()
  const unlinkAbort = forwardAbort(options.signal, controller)
  const timeout = globalThis.setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DataRequestTimeoutError(options.timeoutKind ?? 'resource', DATA_REQUEST_TIMEOUT_MS))
    }
  }, DATA_REQUEST_TIMEOUT_MS)
  try {
    let response: Response
    try {
      response = await fetch(url, {
        cache: options.cache,
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw abortReason(controller.signal)
      }
      throw error
    }
    if (!response.ok) {
      throw new Error(`${requestLabel} failed with ${response.status}.`)
    }
    if (isNativeResponse(response)) {
      if (response.redirected) {
        throw new Error(`${requestLabel} redirected unexpectedly.`)
      }
      if (response.url && new URL(response.url).origin !== requestUrl.origin) {
        throw new Error(`${requestLabel} resolved outside the requested origin.`)
      }
    }
    const value: unknown = isNativeResponse(response)
      ? await readBoundedJson(response, requestLabel, options.maxBytes)
      : await response.json()
    assertValue(value)
    return value
  } finally {
    globalThis.clearTimeout(timeout)
    unlinkAbort()
  }
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
  maxBytes: number
  options: VersionedLoadOptions
  resourcePath: string
  requestCache?: RequestCache
  requestLabel?: string
  timeoutKind?: DataRequestKind
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
      maxBytes: config.maxBytes,
      ...(config.requestLabel ? { requestLabel: config.requestLabel } : {}),
      ...(signal ? { signal } : {}),
      ...(config.timeoutKind ? { timeoutKind: config.timeoutKind } : {}),
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
