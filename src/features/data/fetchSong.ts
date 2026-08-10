import { validateRuntimeSong } from '../../../data-contracts/validators.mjs'
import { assertContract } from './contractValidation'
import {
  JSON_BYTE_LIMITS,
  loadVersionedResource,
  type VersionedLoadOptions,
} from './manifestShared'
import type { LoadResult, SongGuide } from './types'

function assertSong(value: unknown): asserts value is SongGuide {
  assertContract(value, validateRuntimeSong, 'Song response')
}

function assertSongIdentity(song: SongGuide, songId: string, dataVersion: string): void {
  if (song.id !== songId) {
    throw new Error(`Song response id ${song.id} did not match requested ${songId}.`)
  }
  if (song.dataVersion !== dataVersion) {
    throw new Error(`Song response dataVersion ${song.dataVersion} did not match expected ${dataVersion}.`)
  }
}

export async function fetchSong(
  manifestUrl: string,
  songPath: string,
  songId: string,
  options: VersionedLoadOptions,
): Promise<LoadResult<SongGuide>> {
  const result = await loadVersionedResource({
    assertValue: assertSong,
    checkValue: (song) => assertSongIdentity(song, songId, options.expectedDataVersion),
    label: '곡 데이터',
    manifestUrl,
    maxBytes: JSON_BYTE_LIMITS.song,
    options,
    requestCache: 'force-cache',
    requestLabel: 'Song request',
    resourcePath: songPath,
    timeoutKind: 'song',
    versionedLeaf: true,
  })
  return {
    data: result.data,
    source: result.source,
    ...(result.warning ? { warning: result.warning } : {}),
  }
}
