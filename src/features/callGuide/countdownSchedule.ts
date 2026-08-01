export const automaticFirstLyricCountdownDurationMs = 3000

export interface CountdownCue {
  id: string
  startMs: number
  endMs: number
  source: 'auto' | 'explicit'
}

interface CountdownSongLike {
  youtube: {
    startOffsetMs: number
  }
  display: {
    defaultLyricsLanguage: string
    autoFirstLyricCountdown?: boolean
  }
  lyrics: readonly {
    id: string
    startMs: number
  }[]
  countdownEvents?: readonly {
    id: string
    startMs: number
    endMs: number
  }[]
}

function rangesOverlap(first: CountdownCue, second: CountdownCue): boolean {
  return first.startMs < second.endMs && second.startMs < first.endMs
}

function compareCues(first: CountdownCue, second: CountdownCue): number {
  return first.startMs - second.startMs || first.endMs - second.endMs || first.id.localeCompare(second.id)
}

export function buildCountdownSchedule(song: CountdownSongLike): CountdownCue[] {
  const explicitCues = (song.countdownEvents ?? [])
    .map<CountdownCue>((event) => ({ ...event, source: 'explicit' }))
    .sort(compareCues)
  const firstLyric = song.lyrics[0]

  if (
    !firstLyric
    || song.display.autoFirstLyricCountdown === false
    || firstLyric.startMs - song.youtube.startOffsetMs < automaticFirstLyricCountdownDurationMs
  ) {
    return explicitCues
  }

  const automaticCue: CountdownCue = {
    id: `auto:first-lyric:${firstLyric.id}`,
    startMs: firstLyric.startMs - automaticFirstLyricCountdownDurationMs,
    endMs: firstLyric.startMs,
    source: 'auto',
  }

  if (explicitCues.some((cue) => rangesOverlap(cue, automaticCue))) {
    return explicitCues
  }

  return [...explicitCues, automaticCue].sort(compareCues)
}

export function countdownDigit(cue: CountdownCue, currentMs: number): 1 | 2 | 3 | null {
  if (currentMs < cue.startMs || currentMs >= cue.endMs) {
    return null
  }

  const digit = 3 - Math.floor(((currentMs - cue.startMs) * 3) / (cue.endMs - cue.startMs))
  return Math.min(3, Math.max(1, digit)) as 1 | 2 | 3
}

export function countdownSnapshot(schedule: readonly CountdownCue[], currentMs: number): string | null {
  for (const cue of schedule) {
    const digit = countdownDigit(cue, currentMs)
    if (digit !== null) {
      return `${cue.source}:${cue.id}:${digit}`
    }
  }

  return null
}

export function countdownDigitFromSnapshot(snapshot: string): 1 | 2 | 3 {
  return Number(snapshot.slice(-1)) as 1 | 2 | 3
}

export function countdownStartForLyric(
  schedule: readonly CountdownCue[],
  lyricStartMs: number,
): number | undefined {
  return schedule.find((cue) => cue.endMs === lyricStartMs)?.startMs
}
