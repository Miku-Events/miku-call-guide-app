import type { CallEvent, LyricLine, SongGuide } from '../data/types'
import { createPlaybackBoundaryIndex } from './playbackBoundaryIndex'

const lyric = (id: string, startMs: number, endMs: number): LyricLine => ({
  id,
  time: `${startMs} --> ${endMs}`,
  startMs,
  endMs,
  text: { ja: id },
})

const globalCall = (id: string, startMs: number, endMs: number): CallEvent => ({
  id,
  lyricLineId: null,
  placement: { mode: 'globalTrack', lane: 'above', align: 'timeline' },
  time: `${startMs} --> ${endMs}`,
  startMs,
  endMs,
  text: { ko: id },
  markers: {
    point: { enabled: false, style: 'none', direction: 'auto' },
    range: { enabled: false, style: 'none' },
  },
  activation: { mode: 'manualTime' },
  cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
})

function testSong(lyrics: LyricLine[], callEvents: CallEvent[] = []): SongGuide {
  return { lyrics, callEvents } as SongGuide
}

describe('createPlaybackBoundaryIndex', () => {
  it('uses half-open lyric intervals at start, end, and gap boundaries', () => {
    const index = createPlaybackBoundaryIndex(testSong([
      lyric('first', 100, 200),
      lyric('second', 300, 400),
    ]))

    expect(index.snapshotAt(99).activeLineId).toBeNull()
    expect(index.snapshotAt(100).activeLineId).toBe('first')
    expect(index.snapshotAt(199.999).activeLineId).toBe('first')
    expect(index.snapshotAt(200).activeLineId).toBeNull()
    expect(index.snapshotAt(299).activeLineId).toBeNull()
    expect(index.snapshotAt(300).activeLineId).toBe('second')
    expect(index.snapshotAt(400).activeLineId).toBeNull()
  })

  it('returns stable references when seeking forward, through gaps, and backward', () => {
    const index = createPlaybackBoundaryIndex(testSong([
      lyric('first', 0, 100),
      lyric('second', 200, 300),
    ]))

    const first = index.snapshotAt(10)
    const gap = index.snapshotAt(150)
    const second = index.snapshotAt(250)

    expect(index.snapshotAt(90)).toBe(first)
    expect(index.snapshotAt(199)).toBe(gap)
    expect(index.snapshotAt(299)).toBe(second)
    expect(index.snapshotAt(20)).toBe(first)
  })

  it('preserves original-array priority for overlapping lyrics', () => {
    const first = lyric('first-in-array', 100, 400)
    const second = lyric('second-in-array', 0, 500)
    const index = createPlaybackBoundaryIndex(testSong([first, second]))

    expect(index.snapshotAt(50).activeLine).toBe(second)
    expect(index.snapshotAt(100).activeLine).toBe(first)
    expect(index.snapshotAt(399).activeLine).toBe(first)
    expect(index.snapshotAt(400).activeLine).toBe(second)
  })

  it('preserves original global-call order and overlapping half-open intervals', () => {
    const laterStart = globalCall('later-start', 200, 500)
    const earlierStart = globalCall('earlier-start', 100, 300)
    const lyricCall = {
      id: 'lyric-only',
      lyricLineId: 'line',
      placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1 },
      text: { ko: 'lyric' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
      activation: { mode: 'lineActive' },
      cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
    } as CallEvent
    const index = createPlaybackBoundaryIndex(testSong(
      [lyric('line', 0, 1000)],
      [laterStart, lyricCall, earlierStart],
    ))

    expect(index.snapshotAt(199).globalCalls.map((call) => call.id)).toEqual(['earlier-start'])
    expect(index.snapshotAt(200).globalCalls.map((call) => call.id)).toEqual(['later-start', 'earlier-start'])
    expect(index.snapshotAt(300).globalCalls.map((call) => call.id)).toEqual(['later-start'])
    expect(index.snapshotAt(500).globalCalls).toEqual([])
  })

  it('reuses a snapshot across boundaries that do not change the visible state', () => {
    const first = lyric('first-in-array', 0, 500)
    const hiddenOverlap = lyric('hidden-overlap', 100, 200)
    const index = createPlaybackBoundaryIndex(testSong([first, hiddenOverlap]))

    expect(index.changePoints).toEqual([0, 500])
    expect(index.snapshotAt(50)).toBe(index.snapshotAt(150))
  })
})
