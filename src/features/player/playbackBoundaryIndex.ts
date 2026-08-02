import type { CallEvent, LyricLine, SongGuide } from '../data/types'

export type GlobalCallEvent = Extract<CallEvent, { startMs: number }>

export interface PlaybackBoundarySnapshot {
  readonly activeLine: LyricLine | null
  readonly activeLineId: string | null
  readonly globalCalls: readonly GlobalCallEvent[]
}

export interface PlaybackBoundaryIndex {
  readonly changePoints: readonly number[]
  snapshotAt: (timeMs: number) => PlaybackBoundarySnapshot
}

const EMPTY_GLOBAL_CALLS = Object.freeze([]) as readonly GlobalCallEvent[]
const EMPTY_SNAPSHOT: PlaybackBoundarySnapshot = Object.freeze({
  activeLine: null,
  activeLineId: null,
  globalCalls: EMPTY_GLOBAL_CALLS,
})

function isGlobalCall(call: CallEvent): call is GlobalCallEvent {
  return call.startMs !== undefined
}

function snapshotAtBoundary(song: SongGuide, timeMs: number): PlaybackBoundarySnapshot {
  const activeLine = song.lyrics.find((line) => line.startMs <= timeMs && timeMs < line.endMs) ?? null
  const globalCalls = song.callEvents.filter(
    (call): call is GlobalCallEvent => isGlobalCall(call) && call.startMs <= timeMs && timeMs < call.endMs,
  )

  if (!activeLine && globalCalls.length === 0) {
    return EMPTY_SNAPSHOT
  }

  return Object.freeze({
    activeLine,
    activeLineId: activeLine?.id ?? null,
    globalCalls: Object.freeze(globalCalls),
  })
}

function hasSameState(previous: PlaybackBoundarySnapshot, next: PlaybackBoundarySnapshot): boolean {
  if (previous.activeLine !== next.activeLine || previous.globalCalls.length !== next.globalCalls.length) {
    return false
  }

  return previous.globalCalls.every((call, index) => call === next.globalCalls[index])
}

/**
 * Builds immutable playback states at lyric and global-call boundaries. Building
 * the index preserves the contract arrays' order; playback lookups only perform
 * a binary search and return the same snapshot reference inside a state segment.
 */
export function createPlaybackBoundaryIndex(song: SongGuide): PlaybackBoundaryIndex {
  const candidateBoundaries = new Set<number>()

  song.lyrics.forEach((line) => {
    candidateBoundaries.add(line.startMs)
    candidateBoundaries.add(line.endMs)
  })
  song.callEvents.forEach((call) => {
    if (!isGlobalCall(call)) {
      return
    }
    candidateBoundaries.add(call.startMs)
    candidateBoundaries.add(call.endMs)
  })

  const sortedCandidates = Array.from(candidateBoundaries).sort((left, right) => left - right)
  const changePoints: number[] = []
  const snapshots: PlaybackBoundarySnapshot[] = []
  let previous = EMPTY_SNAPSHOT

  sortedCandidates.forEach((timeMs) => {
    const next = snapshotAtBoundary(song, timeMs)
    if (hasSameState(previous, next)) {
      return
    }

    changePoints.push(timeMs)
    snapshots.push(next)
    previous = next
  })

  const frozenChangePoints = Object.freeze(changePoints)
  const frozenSnapshots = Object.freeze(snapshots)

  return Object.freeze({
    changePoints: frozenChangePoints,
    snapshotAt(timeMs: number) {
      if (Number.isNaN(timeMs) || frozenChangePoints.length === 0 || timeMs < frozenChangePoints[0]) {
        return EMPTY_SNAPSHOT
      }

      let low = 0
      let high = frozenChangePoints.length
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2)
        if (frozenChangePoints[middle] <= timeMs) {
          low = middle + 1
        } else {
          high = middle
        }
      }

      return frozenSnapshots[low - 1] ?? EMPTY_SNAPSHOT
    },
  })
}
