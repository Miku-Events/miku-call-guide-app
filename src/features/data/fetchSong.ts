import { validateRuntimeSong } from '../../../data-contracts/validators.mjs'
import { loadCache, removeCache, resourceCacheKey, saveCache } from './cacheStore'
import { assertContract } from './contractValidation'
import { resolveVersionedLeafUrl, type VersionedLoadOptions } from './manifestShared'
import type { LoadResult, SongGuide } from './types'
import { dataRequestTimeoutReason } from './dataRequestTimeout'

const pendingSongs = new Map<string, Promise<LoadResult<SongGuide>>>()

function assertSong(value: unknown): asserts value is SongGuide {
  assertContract(value, validateRuntimeSong, 'Song response')
}

function assertSongIdentity(song: SongGuide, songId: string, dataVersion: string): void {
  if (song.id !== songId) {
    throw new Error(`Song response id ${song.id} did not match requested ${songId}.`)
  }
  if (song.dataVersion !== dataVersion) {
    throw new Error(
      `Song response dataVersion ${song.dataVersion} did not match expected ${dataVersion}.`,
    )
  }
}

function validatedCachedSong(
  value: unknown,
  songId: string,
  dataVersion: string,
): SongGuide | null {
  try {
    assertSong(value)
    assertSongIdentity(value, songId, dataVersion)
    return value
  } catch {
    return null
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

export function fetchSong(
  manifestUrl: string,
  songPath: string,
  songId: string,
  options: VersionedLoadOptions,
): Promise<LoadResult<SongGuide>> {
  if (!options.expectedDataVersion) {
    return Promise.reject(new Error('Expected dataVersion is required for song data.'))
  }
  const cacheKey = resourceCacheKey(manifestUrl, options.expectedDataVersion, songPath)
  const url = resolveVersionedLeafUrl(manifestUrl, songPath, options.expectedDataVersion)
  const operation = async (): Promise<LoadResult<SongGuide>> => {
    try {
      if (options.signal?.aborted) {
        throw abortReason(options.signal)
      }
      const response = await fetch(url, {
        cache: 'force-cache',
        ...(options.signal ? { signal: options.signal } : {}),
      })
      if (!response.ok) {
        throw new Error(`Song request failed with ${response.status}.`)
      }

      const data: unknown = await response.json()
      assertSong(data)
      assertSongIdentity(data, songId, options.expectedDataVersion)
      saveCache(cacheKey, data, { currentDataVersion: options.expectedDataVersion })
      return { data, source: 'network' }
    } catch (error) {
      const timeoutError = dataRequestTimeoutReason(options.signal)
      if (!timeoutError && (isAbortError(error) || options.signal?.aborted)) {
        throw error
      }
      const cached = loadCache<unknown>(cacheKey)
      if (cached) {
        const cachedSong = validatedCachedSong(
          cached.value,
          songId,
          options.expectedDataVersion,
        )
        if (!cachedSong) {
          removeCache(cacheKey)
          throw timeoutError ?? error
        }

        return {
          data: cachedSong,
          source: 'cache',
          warning: cached.freshness === 'stale'
            ? `최신 곡 데이터를 불러오지 못해 ${cached.savedAt}의 오래된 캐시 snapshot을 사용 중입니다.`
            : `최신 곡 데이터를 불러오지 못해 ${cached.savedAt} 캐시를 사용 중입니다.`,
        }
      }

      throw timeoutError ?? error
    }
  }

  if (options.signal) {
    return operation()
  }
  const pendingKey = `${cacheKey}:${encodeURIComponent(songId)}`
  const existing = pendingSongs.get(pendingKey)
  if (existing) {
    return existing
  }
  const pending = operation().finally(() => {
    pendingSongs.delete(pendingKey)
  })
  pendingSongs.set(pendingKey, pending)
  return pending
}
