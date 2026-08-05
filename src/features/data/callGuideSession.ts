import { normalizeManifestIdentity, resourceCacheKey } from './cacheStore'
import {
  fetchCallGuideManifest,
  type ResolvedLoadResult,
} from './fetchCallGuideManifest'
import { fetchSong } from './fetchSong'
import {
  CALL_GUIDE_LOAD_DEADLINE_MS,
  DataRequestTimeoutError,
} from './dataRequestTimeout'
import { resetManifestSessionForTests } from './manifestFamily'
import { createSharedResourceStore } from './sharedResourceStore'
import type { CallGuideManifest, LoadResult, ManifestSong, SongGuide } from './types'

export { CALL_GUIDE_LOAD_DEADLINE_MS, DataRequestTimeoutError } from './dataRequestTimeout'

export interface SessionLoadOptions {
  force?: boolean
  signal?: AbortSignal
}

const songStore = createSharedResourceStore<LoadResult<SongGuide>>({
  completedLimit: 5,
  deadline: {
    error: () => new DataRequestTimeoutError('song'),
    timeoutMs: CALL_GUIDE_LOAD_DEADLINE_MS,
  },
})
const manifestStore = createSharedResourceStore<ResolvedLoadResult<CallGuideManifest>>({
  completedLimit: Number.MAX_SAFE_INTEGER,
})

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

function loadManifestInternal(
  rootManifestUrl: string,
  options: SessionLoadOptions,
  retain: boolean,
): Promise<ResolvedLoadResult<CallGuideManifest>> {
  if (!rootManifestUrl) {
    return Promise.reject(new Error('VITE_DATA_MANIFEST_URL is not configured.'))
  }
  const key = normalizeManifestIdentity(rootManifestUrl)
  return manifestStore.acquire(key, {
    force: options.force,
    retain,
    signal: options.signal,
    load: (signal) => fetchCallGuideManifest(rootManifestUrl, { signal }),
  })
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
  retain: boolean,
): Promise<LoadResult<SongGuide>> {
  const key = songSessionKey(manifestResult, song)
  return songStore.acquire(key, {
    force: options.force,
    retain,
    signal: options.signal,
    load: (signal) => fetchSong(manifestResult.url, song.path, song.id, {
      expectedDataVersion: manifestResult.data.dataVersion,
      signal,
    }),
  })
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

export async function prefetchCallGuideSong(rootManifestUrl: string, songId: string): Promise<void> {
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
  manifestStore.reset(new DOMException('Session reset.', 'AbortError'))
  resetManifestSessionForTests()
  songStore.reset(new DOMException('Session reset.', 'AbortError'))
}

export function callGuideSessionSnapshotForTests(): {
  manifests: number
  pendingManifests: number
  pendingSongs: number
  songs: number
} {
  const manifest = manifestStore.snapshot()
  const song = songStore.snapshot()
  return {
    manifests: manifest.completed,
    pendingManifests: manifest.pending,
    pendingSongs: song.pending,
    songs: song.completed,
  }
}

export const getCallGuideManifest = loadCallGuideManifest
export const getCallGuideSong = loadCallGuideSong
