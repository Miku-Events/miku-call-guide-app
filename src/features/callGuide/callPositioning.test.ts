import { describe, expect, it } from 'vitest'
import type { CallEvent, LyricLine } from '../data/types'
import {
  callKindsInSong,
  callsForLine,
  fallbackAnchorPercent,
  findActiveLyric,
  normalizedCallKind,
  splitGraphemes,
  splitGraphemeTokens,
  streamingLyricWindow,
} from './callPositioning'

describe('callPositioning', () => {
  it('finds the active lyric by startMs and endMs', () => {
    const lyrics: LyricLine[] = [
      { id: 'line-001', startMs: 0, endMs: 1000, text: { ja: 'one' } },
      { id: 'line-002', startMs: 1000, endMs: 2000, text: { ja: 'two' } },
    ]

    expect(findActiveLyric(lyrics, 999)?.id).toBe('line-001')
    expect(findActiveLyric(lyrics, 1000)?.id).toBe('line-002')
    expect(findActiveLyric(lyrics, 2500)).toBeNull()
  })

  it('splits visible graphemes instead of UTF-16 code units', () => {
    expect(splitGraphemes('ミク🎵')).toEqual(['ミ', 'ク', '🎵'])
  })

  it('groups graphemes into unbroken word tokens while keeping 1-based indexes', () => {
    const tokens = splitGraphemeTokens('METEOR Future')

    expect(tokens.map((token) => token.text)).toEqual(['METEOR ', 'Future'])
    expect(tokens[0].graphemes.map((grapheme) => grapheme.index)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(tokens[1].graphemes.map((grapheme) => grapheme.index)).toEqual([8, 9, 10, 11, 12, 13])
  })

  it('computes a stable fallback percentage for a 1-based pointChar', () => {
    expect(fallbackAnchorPercent(1, 4)).toBe(12.5)
    expect(fallbackAnchorPercent(4, 4)).toBe(87.5)
  })

  it('falls back unknown runtime call kinds to custom styling', () => {
    expect(normalizedCallKind({ cue: { kind: 'legacy-response' } })).toBe('custom')
    expect(normalizedCallKind({ cue: { kind: 'penlight' } })).toBe('penlight')
  })

  it('returns the song call kinds once in display priority order', () => {
    const calls = [
      { cue: { kind: 'custom' } },
      { cue: { kind: 'penlight' } },
      { cue: { kind: 'chant' } },
      { cue: { kind: 'penlight' } },
      { cue: { kind: 'legacy-response' } },
    ] as unknown as CallEvent[]

    expect(callKindsInSong(calls)).toEqual(['chant', 'penlight', 'custom'])
  })

  it('builds a previous/current/next streaming lyric window around the active line', () => {
    const lyrics: LyricLine[] = [
      { id: 'line-001', startMs: 0, endMs: 1000, text: { ja: 'one' } },
      { id: 'line-002', startMs: 1000, endMs: 2000, text: { ja: 'two' } },
      { id: 'line-003', startMs: 2000, endMs: 3000, text: { ja: 'three' } },
    ]

    expect(streamingLyricWindow(lyrics, lyrics[1]).map((item) => `${item.position}:${item.line.id}`)).toEqual([
      'previous:line-001',
      'current:line-002',
      'next:line-003',
    ])
  })

  it('normalizes legacy and segmented lyricTrack calls for each lyric line', () => {
    const calls: CallEvent[] = [
      {
        id: 'call-legacy',
        lyricLineId: 'line-001',
        placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
        anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 2 },
        text: { ko: '하이!' },
        markers: {
          point: { enabled: true, style: 'pointArrow', direction: 'auto' },
          range: { enabled: false, style: 'none' },
        },
        activation: { mode: 'lineActive' },
        cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
      },
      {
        id: 'call-segment',
        placement: { mode: 'lyricTrack', lane: 'below', align: 'charAnchor' },
        text: { ko: '오-!' },
        activation: { mode: 'lineActive' },
        cue: { kind: 'penlight', intensity: 'high', repeat: 1 },
        segments: [
          {
            lyricLineId: 'line-001',
            part: 'start',
            anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3, rangeStartChar: 3, rangeEndChar: 4 },
            markers: {
              point: { enabled: true, style: 'pointArrow', direction: 'auto' },
              range: { enabled: true, style: 'bracket' },
            },
          },
          {
            lyricLineId: 'line-002',
            part: 'end',
            anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1, rangeStartChar: 1, rangeEndChar: 2 },
            markers: {
              point: { enabled: false, style: 'none', direction: 'auto' },
              range: { enabled: true, style: 'bracket' },
            },
          },
        ],
      },
    ]

    expect(callsForLine(calls, 'line-001').map((call) => [call.id, call.sourceCallId, call.segmentPart])).toEqual([
      ['call-legacy', 'call-legacy', undefined],
      ['call-segment::segment-0', 'call-segment', 'start'],
    ])
    expect(callsForLine(calls, 'line-002').map((call) => [call.sourceCallId, call.anchor.pointChar, call.markers.point.enabled])).toEqual([
      ['call-segment', 1, false],
    ])
  })
})
