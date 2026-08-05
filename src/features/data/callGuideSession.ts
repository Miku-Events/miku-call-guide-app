import { normalizeManifestIdentity, resourceCacheKey } from './cacheStore'
import {
  fetchCallGuideManifest,
  type ResolvedLoadResult,
} from './fetchCallGuideManifest'
import { fetchSong } from './fetchSong'
import {
  CALL_GUIDE_LOAD_DEADLINE_MS,
  DataRequestTimeoutError,
  type DataRequestKind,
} from './dataRequestTimeout'
import type { CallGuideManifest, LoadResult, ManifestSong, SongGuide } from './types'

export { CALL_GUIDE_LOAD_DEADLINE_MS, DataRequestTimeoutError } from './dataRequestTimeout'

export interface SessionLoadOptions {
  force?: boolean
  signal?: AbortSignal
}

interface SharedLoad<T> {
  consumers: number
  controller: AbortController
  promise: Promise<T>
  retainedConsumers: number
  settled: boolean
}

const SONG_LRU_LIMIT = 5
const manifestResults = new Map<string, ResolvedLoadResult<CallGuideManifest>>()
const manifestLoads = new Map<string, SharedLoad<ResolvedLoadResult<CallGuideManifest>>>()
const songResults = new Map<string, LoadResult<SongGuide>>()
const songLoads = new Map<string, SharedLoad<LoadResult<SongGuide>>>()

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) {
    return signal.reason
  }
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function rejectedAbort<T>(signal: AbortSignal): Promise<T> {
  return Promise.reject(abortReason(signal))
}

function createSharedLoad<T>(
  loads: Map<string, SharedLoad<T>>,
  key: string,
  kind: DataRequestKind,
  operation: (signal: AbortSignal) => Promise<T>,
  completed: (result: T) => void,
): SharedLoad<T> {
  const controller = new AbortController()
  const deadlineTimer = globalThis.setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DataRequestTimeoutError(kind))
    }
  }, CALL_GUIDE_LOAD_DEADLINE_MS)
  const task: SharedLoad<T> = {
    consumers: 0,
    controller,
    promise: Promise.resolve(undefined as T),
    retainedConsumers: 0,
    settled: false,
  }
  task.promise = Promise.resolve()
    .then(() => operation(controller.signal))
    .then((result) => {
      completed(result)
      return result
    })
    .finally(() => {
      globalThis.clearTimeout(deadlineTimer)
      task.settled = true
      if (loads.get(key) === task) {
        loads.delete(key)
      }
    })
  loads.set(key, task)
  return task
}

function releaseShared<T>(task: SharedLoad<T>, retained: boolean): void {
  if (retained) {
    task.retainedConsumers -= 1
  } else {
    task.consumers -= 1
  }
  if (task.consumers !== 0 || task.retainedConsumers !== 0 || task.settled) {
    return
  }
  queueMicrotask(() => {
    if (
      task.consumers === 0
      && task.retainedConsumers === 0
      && !task.settled
      && !task.controller.signal.aborted
    ) {
      task.controller.abort(new DOMException('No active data consumers remain.', 'AbortError'))
    }
  })
}

function consumeShared<T>(
  task: SharedLoad<T>,
  signal: AbortSignal | undefined,
  retained: boolean,
): Promise<T> {
  if (signal?.aborted) {
    return rejectedAbort(signal)
  }
  if (retained) {
    task.retainedConsumers += 1
  } else {
    task.consumers += 1
  }

  return new Promise<T>((resolve, reject) => {
    let finished = false
    const finish = (callback: () => void) => {
      if (finished) {
        return
      }
      finished = true
      signal?.removeEventListener('abort', onAbort)
      releaseShared(task, retained)
      callback()
    }
    const onAbort = () => finish(() => reject(abortReason(signal as AbortSignal)))
    signal?.addEventListener('abort', onAbort, { once: true })
    task.promise.then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

function manifestSessionKey(rootManifestUrl: string): string {
  return normalizeManifestIdentity(rootManifestUrl)
}

function songSessionKey(
  manifestResult: ResolvedLoadResult<CallGuideManifest>,
  song: ManifestSong,
): string {
  return `${resourceCacheKey(
    manifestResult.url,
    manifestResult.data.dataVersion,
    song.path,
  )}:${encodeURIComponent(song.id)}`
}

function completedSong(key: string): LoadResult<SongGuide> | undefined {
  const result = songResults.get(key)
  if (result) {
    songResults.delete(key)
    songResults.set(key, result)
  }
  return result
}

function rememberSong(key: string, result: LoadResult<SongGuide>): void {
  songResults.delete(key)
  songResults.set(key, result)
  while (songResults.size > SONG_LRU_LIMIT) {
    const oldest = songResults.keys().next().value as string | undefined
    if (oldest === undefined) {
      break
    }
    songResults.delete(oldest)
  }
}

function loadManifestInternal(
  rootManifestUrl: string,
  options: SessionLoadOptions,
  retained: boolean,
): Promise<ResolvedLoadResult<CallGuideManifest>> {
  if (options.signal?.aborted) {
    return rejectedAbort(options.signal)
  }
  if (!rootManifestUrl) {
    return Promise.reject(new Error('VITE_DATA_MANIFEST_URL is not configured.'))
  }
  const key = manifestSessionKey(rootManifestUrl)
  const pending = manifestLoads.get(key)
  const existing = pending && !pending.controller.signal.aborted ? pending : undefined
  if (existing) {
    return consumeShared(existing, options.signal, retained)
  }
  const completed = manifestResults.get(key)
  if (completed && !options.force) {
    return Promise.resolve(completed)
  }
  const task = createSharedLoad(
    manifestLoads,
    key,
    'manifest',
    (signal) => fetchCallGuideManifest(rootManifestUrl, { signal }),
    (result) => {
      manifestResults.set(key, result)
    },
  )
  return consumeShared(task, options.signal, retained)
}

export function loadCallGuideManifest(
  rootManifestUrl: string,
  options: SessionLoadOptions = {},
): Promise<ResolvedLoadResult<CallGuideManifest>> {
  return loadManifestInternal(rootManifestUrl, options, false)
}

function loadSongInternal(
  manifestResult: ResolvedLoadResult<CallGuideManifest>,
  song: ManifestSong,
  options: SessionLoadOptions,
  retained: boolean,
): Promise<LoadResult<SongGuide>> {
  if (options.signal?.aborted) {
    return rejectedAbort(options.signal)
  }
  const key = songSessionKey(manifestResult, song)
  const pending = songLoads.get(key)
  const existing = pending && !pending.controller.signal.aborted ? pending : undefined
  if (existing) {
    return consumeShared(existing, options.signal, retained)
  }
  const completed = completedSong(key)
  if (completed && !options.force) {
    return Promise.resolve(completed)
  }
  const task = createSharedLoad(
    songLoads,
    key,
    'song',
    (signal) => fetchSong(manifestResult.url, song.path, song.id, {
      expectedDataVersion: manifestResult.data.dataVersion,
      signal,
    }),
    (result) => rememberSong(key, result),
  )
  return consumeShared(task, options.signal, retained)
}

export function loadCallGuideSong(
  manifestResult: ResolvedLoadResult<CallGuideManifest>,
  song: ManifestSong,
  options: SessionLoadOptions = {},
): Promise<LoadResult<SongGuide>> {
  return loadSongInternal(manifestResult, song, options, false)
}

function dataSaverEnabled(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return Boolean((navigator as Navigator & {
    connection?: { saveData?: boolean }
  }).connection?.saveData)
}

export async function prefetchCallGuideSong(
  rootManifestUrl: string,
  songId: string,
): Promise<void> {
  if (dataSaverEnabled()) {
    return
  }
  const manifest = await loadManifestInternal(rootManifestUrl, {}, true)
  const song = manifest.data.songs.find((entry) => entry.id === songId)
  if (!song) {
    throw new Error(`Song "${songId}" was not found in manifest.`)
  }
  await loadSongInternal(manifest, song, {}, true)
}

export function prefetchCallGuideManifest(rootManifestUrl: string): Promise<void> {
  return loadManifestInternal(rootManifestUrl, {}, true).then(() => undefined)
}

export function resetCallGuideSessionForTests(): void {
  for (const task of [...manifestLoads.values(), ...songLoads.values()]) {
    if (!task.settled && !task.controller.signal.aborted) {
      task.controller.abort(new DOMException('Session reset.', 'AbortError'))
    }
  }
  manifestResults.clear()
  manifestLoads.clear()
  songResults.clear()
  songLoads.clear()
}

export function callGuideSessionSnapshotForTests(): {
  manifests: number
  pendingManifests: number
  pendingSongs: number
  songs: number
} {
  return {
    manifests: manifestResults.size,
    pendingManifests: manifestLoads.size,
    pendingSongs: songLoads.size,
    songs: songResults.size,
  }
}

export const getCallGuideManifest = loadCallGuideManifest
export const getCallGuideSong = loadCallGuideSong
