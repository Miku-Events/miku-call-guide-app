import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheStorageKey, resourceCacheKey } from './cacheStore'
import { fetchSong } from './fetchSong'
import type { SongGuide } from './types'

const song: SongGuide = {
  schemaVersion: 1,
  dataVersion: 'v1',
  id: 'sample-song',
  status: 'published',
  metadata: {
    title: { ko: '샘플' },
    artist: { ko: '샘플' },
    vocal: ['hatsune-miku'],
    tags: ['sample'],
  },
  youtube: { videoId: 'M7lc1UVf-VE', originalSongId: 'dQw4w9WgXcQ', startOffsetMs: 0 },
  display: {
    defaultLyricsLanguage: 'ja',
    defaultPronunciationLanguage: 'koPronunciation',
    defaultCallLanguage: 'ko',
  },
  timing: { unit: 'ms', durationMs: 6000 },
  lyrics: [
    {
      id: 'line-001',
      time: '00:00:00,000 --> 00:00:06,000',
      startMs: 0,
      endMs: 6000,
      text: { ja: '光るステージへ', koPronunciation: '히카루 스테-지에' },
    },
  ],
  callEvents: [
    {
      id: 'call-001',
      lyricLineId: 'line-001',
      placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3 },
      text: { ko: '하이!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
      activation: { mode: 'lineActive' },
      cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
    },
  ],
  notes: { author: 'contract test' },
}

function withoutDataVersion<T extends { dataVersion: string }>(value: T): Partial<T> {
  const result: Partial<T> = { ...value }
  delete result.dataVersion
  return result
}

describe('fetchSong', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('loads resolved runtime song data from network and writes cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => song,
    })
    vi.stubGlobal(
      'fetch',
      fetchMock,
    )

    const result = await fetchSong('https://example.test/manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })

    expect(result.source).toBe('network')
    expect(result.data.callEvents[0].text.ko).toBe('하이!')
    expect(window.localStorage.length).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/songs/sample-song.json?_miku_data_version=v1',
      { cache: 'no-cache' },
    )
  })

  it.each([
    ['a different', { ...song, dataVersion: 'v2' }],
    ['a missing', withoutDataVersion(song)],
  ])('rejects network song data with %s dataVersion without caching it', async (_label, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))

    await expect(fetchSong(
      'https://example.test/call-guide-manifest.json',
      'songs/sample-song.json',
      'sample-song',
      { expectedDataVersion: 'v1' },
    )).rejects.toThrow(/dataVersion|required property/i)
    expect(window.localStorage.length).toBe(0)
  })

  it('rejects unresolved textRef runtime song data instead of caching it', async () => {
    const unresolvedSong = {
      ...song,
      callEvents: [{ ...song.callEvents[0], text: undefined, textRef: 'call-hai' }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => unresolvedSong,
      }),
    )

    await expect(fetchSong('https://example.test/manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })).rejects.toThrow(
      'textRef',
    )
    expect(window.localStorage.length).toBe(0)
  })

  it('accepts sparse notes and originalSongId from the generated runtime contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => song }),
    )

    const result = await fetchSong('https://example.test/manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })

    expect(result.data.notes).toEqual({ author: 'contract test' })
    expect(result.data.youtube.originalSongId).toBe('dQw4w9WgXcQ')
  })

  it('rejects invalid nested song metadata instead of caching it', async () => {
    const invalidSong = {
      ...song,
      metadata: { ...song.metadata, vocal: [] },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => invalidSong }),
    )

    await expect(fetchSong('https://example.test/manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })).rejects.toThrow()
    expect(window.localStorage.length).toBe(0)
  })

  it('drops invalid cached song data when network fails', async () => {
    window.localStorage.setItem(
      cacheStorageKey(resourceCacheKey('https://example.test/manifest.json', 'v1', 'songs/sample-song.json')),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        value: {
          ...song,
          callEvents: [{ ...song.callEvents[0], text: undefined, textRef: 'call-hai' }],
        },
      }),
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await expect(fetchSong('https://example.test/manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })).rejects.toThrow(
      'offline',
    )
    expect(window.localStorage.length).toBe(0)
  })

  it('uses a valid same-version song cache while offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => song }))
    await fetchSong('https://example.test/call-guide-manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchSong(
      'https://example.test/call-guide-manifest.json',
      'songs/sample-song.json',
      'sample-song',
      { expectedDataVersion: 'v1' },
    )).resolves.toMatchObject({ source: 'cache', data: song })
  })

  it.each([
    ['different', { ...song, dataVersion: 'v2' }],
    ['missing', withoutDataVersion(song)],
  ])('removes a same-key cached song with %s dataVersion', async (_label, cachedSong) => {
    const key = resourceCacheKey(
      'https://example.test/call-guide-manifest.json',
      'v1',
      'songs/sample-song.json',
    )
    window.localStorage.setItem(cacheStorageKey(key), JSON.stringify({
      savedAt: new Date().toISOString(),
      value: cachedSong,
    }))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await expect(fetchSong(
      'https://example.test/call-guide-manifest.json',
      'songs/sample-song.json',
      'sample-song',
      { expectedDataVersion: 'v1' },
    )).rejects.toThrow('offline')
    expect(window.localStorage.getItem(cacheStorageKey(key))).toBeNull()
  })

  it('preserves existing query parameters and the leaf pathname', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => song })
    vi.stubGlobal('fetch', fetchMock)

    await fetchSong(
      'https://example.test/catalog/call-guide-manifest.json?origin=primary',
      '../songs/sample-song.json?lang=ko#lyrics',
      'sample-song',
      { expectedDataVersion: 'v1' },
    )

    const requestedUrl = new URL(fetchMock.mock.calls[0][0])
    expect(requestedUrl.pathname).toBe('/songs/sample-song.json')
    expect(requestedUrl.searchParams.get('lang')).toBe('ko')
    expect(requestedUrl.searchParams.get('_miku_data_version')).toBe('v1')
    expect(requestedUrl.hash).toBe('#lyrics')
  })

  it('never reuses a cached song from a different dataVersion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => song }))
    await fetchSong('https://example.test/call-guide-manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-v2')))
    await expect(fetchSong('https://example.test/call-guide-manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v2',
    })).rejects.toThrow('offline-v2')
  })

  it('forwards signal and does not use a same-version cache after AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => song }))
    await fetchSong('https://example.test/call-guide-manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })

    const controller = new AbortController()
    const abortError = new DOMException('aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(abortError)
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchSong('https://example.test/call-guide-manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
      signal: controller.signal,
    })).rejects.toBe(abortError)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/songs/sample-song.json?_miku_data_version=v1',
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('returns a valid network song when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => song }))

    await expect(fetchSong('https://example.test/call-guide-manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })).resolves.toMatchObject({ source: 'network', data: song })
  })

  it('rejects a song whose id does not match the requested song', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...song, id: 'other-song' }),
    }))

    await expect(fetchSong('https://example.test/call-guide-manifest.json', 'songs/sample-song.json', 'sample-song', {
      expectedDataVersion: 'v1',
    })).rejects.toThrow(/id.*sample-song/i)
    expect(window.localStorage.length).toBe(0)
  })
})
