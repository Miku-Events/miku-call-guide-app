import { describe, expect, it, vi } from 'vitest'
import type { CallGuideManifest } from '../data/types'
import {
  buildCatalogSnapshot,
  fallbackEventTitle,
  filterCatalogSongs,
  normalizeCatalogSearchText,
} from './catalogModel'

function manifestWithSongs(count: number): CallGuideManifest {
  return {
    dataVersion: 'catalog-v1',
    eventRegistry: {
      'shared-event': {
        title: { ko: '공통 이벤트' },
      },
    },
    generatedAt: '2026-08-05T00:00:00.000Z',
    schemaVersion: 1,
    songs: Array.from({ length: count }, (_, index) => ({
      artist: { en: `Artist ${index}`, ja: `アーティスト ${index}`, ko: `아티스트 ${index}` },
      callSummary: { en: `Future Light call ${index}` },
      id: `song-${index}`,
      path: `songs/song-${index}.json`,
      status: 'published' as const,
      tags: ['shared-event', `group-${index % 10}`],
      title: { en: `Song ${index}`, ja: `ソング ${index}`, ko: `노래 ${index}` },
      youtubeVideoId: `video${index.toString().padStart(6, '0')}`,
    })),
  }
}

describe('catalog model', () => {
  it('builds one indexed, shuffled snapshot without retaining per-folder song arrays', () => {
    const manifest = manifestWithSongs(500)
    const originalOrder = manifest.songs.map((song) => song.id)
    const random = vi.fn(() => 0)

    const snapshot = buildCatalogSnapshot(manifest, random)

    expect(snapshot.dataVersion).toBe('catalog-v1')
    expect(snapshot.songs).toHaveLength(500)
    expect(snapshot.songs[0]).toMatchObject({
      artist: '아티스트 1',
      title: '노래 1',
      usesOriginalArtwork: false,
    })
    expect(snapshot.songs[0].thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\/.+\/hqdefault\.jpg$/)
    expect(manifest.songs.map((song) => song.id)).toEqual(originalOrder)
    expect(random).toHaveBeenCalledTimes(499)
    expect(snapshot.eventFolders[0]).toEqual({
      id: 'shared-event',
      songCount: 500,
      title: { ko: '공통 이벤트' },
    })
    expect(snapshot.eventFolders[0]).not.toHaveProperty('songs')
  })

  it('lowercases the query once against precomputed lowercase search text', () => {
    const snapshot = buildCatalogSnapshot(manifestWithSongs(20), () => 0.5)
    const searchTextReferences = snapshot.songs.map((entry) => entry.searchText)

    expect(normalizeCatalogSearchText('FUTURE light')).toBe('future light')
    expect(filterCatalogSongs(snapshot.songs, 'FUTURE light call 7', null).map((entry) => entry.song.id))
      .toEqual(['song-7'])
    expect(filterCatalogSongs(snapshot.songs, '', 'group-3')).toHaveLength(2)
    expect(filterCatalogSongs(snapshot.songs, '', null)).toBe(snapshot.songs)

    for (let index = 0; index < 20; index += 1) {
      filterCatalogSongs(snapshot.songs, `song ${index}`, null)
    }
    expect(snapshot.songs.map((entry) => entry.searchText)).toEqual(searchTextReferences)
  })

  it('creates a localized fallback title for unregistered event tags', () => {
    expect(fallbackEventTitle('miku-expo-vr')).toEqual({
      en: 'Miku EXPO VR',
      ja: 'Miku EXPO VR',
      ko: 'Miku EXPO VR',
    })
  })
})
