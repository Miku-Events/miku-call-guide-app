import { localizedText } from '../../shared/i18n/localizedText'
import type { CallGuideManifest, LocalizedText, ManifestSong } from '../data/types'
import { shuffledCopy, type RandomSource } from './shuffle'

export interface CatalogSongEntry {
  artist: string
  searchText: string
  song: ManifestSong
  thumbnailUrl: string
  title: string
  usesOriginalArtwork: boolean
}

export interface CatalogEventFolder {
  id: string
  songCount: number
  title: LocalizedText
}

export interface CatalogSnapshot {
  dataVersion: string
  eventFolders: readonly CatalogEventFolder[]
  songs: readonly CatalogSongEntry[]
}

const EMPTY_BLACKLIST = new Set<string>()

export function normalizeCatalogSearchText(value: string): string {
  return value.toLowerCase()
}

function formatFallbackEventTitle(tag: string): string {
  return tag
    .split('-')
    .map((word) => {
      if (word === 'miku') return 'Miku'
      if (word === 'expo') return 'EXPO'
      if (word === 'vr') return 'VR'
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function songSearchText(song: ManifestSong): string {
  return normalizeCatalogSearchText([
    ...Object.values(song.title),
    ...Object.values(song.artist),
    ...Object.values(song.callSummary ?? {}),
    song.youtubeVideoId,
    ...song.tags,
  ].join(' '))
}

function youtubeThumbnailUrl(song: ManifestSong): string {
  return `https://i.ytimg.com/vi/${song.originalSongId ?? song.youtubeVideoId}/hqdefault.jpg`
}

export function buildCatalogSnapshot(
  manifest: CallGuideManifest,
  random: RandomSource = Math.random,
  blacklistedTags: ReadonlySet<string> = EMPTY_BLACKLIST,
): CatalogSnapshot {
  const songs = shuffledCopy(manifest.songs, random).map((song): CatalogSongEntry => ({
    artist: localizedText(song.artist, 'ko', ['ja', 'en']),
    searchText: songSearchText(song),
    song,
    thumbnailUrl: youtubeThumbnailUrl(song),
    title: localizedText(song.title, 'ko', ['ja', 'en']),
    usesOriginalArtwork: Boolean(song.originalSongId),
  }))
  const tagCounts = new Map<string, number>()

  for (const song of manifest.songs) {
    for (const tag of song.tags) {
      if (!blacklistedTags.has(tag)) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }
  }

  const eventRegistry = manifest.eventRegistry ?? {}
  const eventFolders = Array.from(tagCounts, ([tag, songCount]): CatalogEventFolder | null => {
    if (songCount < 2) {
      return null
    }
    const fallbackTitle = formatFallbackEventTitle(tag)
    return {
      id: tag,
      songCount,
      title: eventRegistry[tag]?.title ?? {
        en: fallbackTitle,
        ja: fallbackTitle,
        ko: fallbackTitle,
      },
    }
  })
    .filter((folder): folder is CatalogEventFolder => folder !== null)
    .sort((left, right) => right.songCount - left.songCount)

  return {
    dataVersion: manifest.dataVersion,
    eventFolders,
    songs,
  }
}

export function filterCatalogSongs(
  songs: readonly CatalogSongEntry[],
  query: string,
  selectedTag: string | null,
): readonly CatalogSongEntry[] {
  const normalizedQuery = normalizeCatalogSearchText(query)
  if (!selectedTag && normalizedQuery === '') {
    return songs
  }

  return songs.filter(({ searchText, song }) => (
    (!selectedTag || song.tags.includes(selectedTag))
    && searchText.includes(normalizedQuery)
  ))
}

export function fallbackEventTitle(tag: string): LocalizedText {
  const title = formatFallbackEventTitle(tag)
  return { en: title, ja: title, ko: title }
}
