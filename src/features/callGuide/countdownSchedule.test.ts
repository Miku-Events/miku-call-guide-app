import { describe, expect, it } from 'vitest'
import {
  buildCountdownSchedule,
  countdownDigit,
  countdownSnapshot,
  countdownStartForLyric,
} from './countdownSchedule'

function song(options: {
  autoFirstLyricCountdown?: boolean
  countdownEvents?: { id: string; startMs: number; endMs: number }[]
  firstLyricStartMs?: number
  startOffsetMs?: number
} = {}) {
  return {
    youtube: { startOffsetMs: options.startOffsetMs ?? 0 },
    display: {
      defaultLyricsLanguage: 'ja',
      autoFirstLyricCountdown: options.autoFirstLyricCountdown,
    },
    lyrics: [{ id: 'line-001', startMs: options.firstLyricStartMs ?? 6000 }],
    countdownEvents: options.countdownEvents,
  }
}

describe('countdown schedule', () => {
  it('creates an automatic cue only when the intro gap is at least three seconds', () => {
    expect(buildCountdownSchedule(song({ firstLyricStartMs: 6000, startOffsetMs: 5940 }))).toEqual([])
    expect(buildCountdownSchedule(song({ firstLyricStartMs: 6000, startOffsetMs: 5820 }))).toEqual([])
    expect(buildCountdownSchedule(song({ firstLyricStartMs: 5999, startOffsetMs: 3000 }))).toEqual([])
    expect(buildCountdownSchedule(song({ firstLyricStartMs: 6000, startOffsetMs: 3000 }))).toEqual([
      {
        id: 'auto:first-lyric:line-001',
        startMs: 3000,
        endMs: 6000,
        source: 'auto',
      },
    ])
  })

  it('omits the automatic cue when display configuration disables it', () => {
    expect(buildCountdownSchedule(song({ autoFirstLyricCountdown: false }))).toEqual([])
  })

  it('sorts explicit cues and suppresses the whole automatic cue when any range overlaps', () => {
    expect(buildCountdownSchedule(song({
      countdownEvents: [
        { id: 'later', startMs: 9000, endMs: 12000 },
        { id: 'overlap', startMs: 2500, endMs: 3500 },
      ],
    }))).toEqual([
      { id: 'overlap', startMs: 2500, endMs: 3500, source: 'explicit' },
      { id: 'later', startMs: 9000, endMs: 12000, source: 'explicit' },
    ])
  })

  it('allows an explicit cue to touch an automatic cue boundary', () => {
    expect(buildCountdownSchedule(song({
      countdownEvents: [{ id: 'before', startMs: 1000, endMs: 3000 }],
    }))).toEqual([
      { id: 'before', startMs: 1000, endMs: 3000, source: 'explicit' },
      { id: 'auto:first-lyric:line-001', startMs: 3000, endMs: 6000, source: 'auto' },
    ])
  })

  it('splits any cue range into three equal countdown phases', () => {
    const cue = { id: 'six-seconds', startMs: 6000, endMs: 12000, source: 'explicit' as const }

    expect(countdownDigit(cue, 5999)).toBeNull()
    expect(countdownDigit(cue, 6000)).toBe(3)
    expect(countdownDigit(cue, 7999)).toBe(3)
    expect(countdownDigit(cue, 8000)).toBe(2)
    expect(countdownDigit(cue, 9999)).toBe(2)
    expect(countdownDigit(cue, 10000)).toBe(1)
    expect(countdownDigit(cue, 11999)).toBe(1)
    expect(countdownDigit(cue, 12000)).toBeNull()
  })

  it('returns the same primitive snapshot throughout one phase', () => {
    const schedule = buildCountdownSchedule(song())
    const firstSnapshot = countdownSnapshot(schedule, 3000)
    const laterSnapshot = countdownSnapshot(schedule, 3999)

    expect(firstSnapshot).toBe('auto:auto:first-lyric:line-001:3')
    expect(Object.is(firstSnapshot, laterSnapshot)).toBe(true)
    expect(countdownSnapshot(schedule, 6000)).toBeNull()
  })

  it('finds the effective cue start for lyric seeking', () => {
    const schedule = buildCountdownSchedule(song())

    expect(countdownStartForLyric(schedule, 6000)).toBe(3000)
    expect(countdownStartForLyric(schedule, 9000)).toBeUndefined()
  })
})
