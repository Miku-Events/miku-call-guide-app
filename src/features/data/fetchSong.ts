import { loadCache, removeCache, saveCache } from './cacheStore'
import type { LoadResult, SongGuide } from './types'

function resolveDataUrl(manifestUrl: string, relativePath: string): string {
  return new URL(relativePath, manifestUrl).toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertLocalizedText(value: unknown, path: string): asserts value is Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be a resolved localized text object.`)
  }

  for (const [key, text] of Object.entries(value)) {
    if (typeof text !== 'string') {
      throw new Error(`${path}.${key} must be a string.`)
    }
  }
}

function assertSong(value: unknown): asserts value is SongGuide {
  if (!isRecord(value)) {
    throw new Error('Song response was not an object.')
  }

  const song = value as Partial<SongGuide>
  if (song.schemaVersion !== 1 || !Array.isArray(song.lyrics) || !Array.isArray(song.callEvents)) {
    throw new Error('Song schemaVersion, lyrics, or callEvents were invalid.')
  }

  song.callEvents.forEach((call, index) => {
    if (!isRecord(call)) {
      throw new Error(`Song callEvents[${index}] was not an object.`)
    }

    if ('textRef' in call) {
      throw new Error(`Song callEvents[${index}] still has textRef. Rebuild the data repo so textRef resolves to text.`)
    }

    assertLocalizedText(call.text, `Song callEvents[${index}].text`)
  })
}

export async function fetchSong(
  manifestUrl: string,
  songPath: string,
  songId: string,
): Promise<LoadResult<SongGuide>> {
  const cacheKey = `song:${songId}:v1`

  try {
    const response = await fetch(resolveDataUrl(manifestUrl, songPath), { cache: 'no-cache' })
    if (!response.ok) {
      throw new Error(`Song request failed with ${response.status}.`)
    }

    const data = await response.json()
    assertSong(data)
    saveCache(cacheKey, data)
    return { data, source: 'network' }
  } catch (error) {
    const cached = loadCache<unknown>(cacheKey)
    if (cached) {
      try {
        assertSong(cached.value)
      } catch {
        removeCache(cacheKey)
        throw error
      }

      return {
        data: cached.value,
        source: 'cache',
        warning: `최신 곡 데이터를 불러오지 못해 ${cached.savedAt} 캐시를 사용 중입니다.`,
      }
    }

    throw error
  }
}
