import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSong } from './fetchSong'
import type { SongGuide } from './types'

const song: SongGuide = {
  schemaVersion: 1,
  id: 'sample-song',
  status: 'published',
  metadata: {
    title: { ko: '샘플' },
    artist: { ko: '샘플' },
    vocal: ['hatsune-miku'],
    tags: ['sample'],
  },
  youtube: { videoId: 'M7lc1UVf-VE', startOffsetMs: 0 },
  display: {
    defaultLyricsLanguage: 'ja',
    defaultPronunciationLanguage: 'koPronunciation',
    defaultCallLanguage: 'ko',
  },
  timing: { unit: 'ms', durationMs: 6000 },
  lyrics: [
    {
      id: 'line-001',
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
  notes: { author: '', source: '', reviewComment: '', copyrightNote: '' },
}

describe('fetchSong', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('loads resolved runtime song data from network and writes cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => song,
      }),
    )

    const result = await fetchSong('https://example.test/manifest.json', 'songs/sample-song.json', 'sample-song')

    expect(result.source).toBe('network')
    expect(result.data.callEvents[0].text.ko).toBe('하이!')
    expect(window.localStorage.length).toBe(1)
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

    await expect(fetchSong('https://example.test/manifest.json', 'songs/sample-song.json', 'sample-song')).rejects.toThrow(
      'textRef',
    )
    expect(window.localStorage.length).toBe(0)
  })

  it('drops invalid cached song data when network fails', async () => {
    window.localStorage.setItem(
      'miku-call-guide:song:sample-song:v1',
      JSON.stringify({
        savedAt: '2026-05-19T00:00:00.000Z',
        value: {
          ...song,
          callEvents: [{ ...song.callEvents[0], text: undefined, textRef: 'call-hai' }],
        },
      }),
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await expect(fetchSong('https://example.test/manifest.json', 'songs/sample-song.json', 'sample-song')).rejects.toThrow(
      'offline',
    )
    expect(window.localStorage.length).toBe(0)
  })
})
