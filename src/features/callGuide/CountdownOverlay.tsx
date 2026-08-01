import { useCallback, useSyncExternalStore } from 'react'
import type { PlaybackTimeStore } from '../player/playbackTimeStore'
import {
  countdownDigitFromSnapshot,
  countdownSnapshot,
  type CountdownCue,
} from './countdownSchedule'

interface CountdownOverlayProps {
  schedule: readonly CountdownCue[]
  store: PlaybackTimeStore
}

export function CountdownOverlay({ schedule, store }: CountdownOverlayProps) {
  const getSnapshot = useCallback(
    () => countdownSnapshot(schedule, store.getSnapshot()),
    [schedule, store],
  )
  const snapshot = useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)

  if (snapshot === null) {
    return null
  }

  const digit = countdownDigitFromSnapshot(snapshot)

  return (
    <div
      aria-label={`카운트다운 ${digit}`}
      aria-live="off"
      className="lyric-countdown"
      role="timer"
    >
      <span aria-hidden="true" className="lyric-countdown-number" key={snapshot}>
        {digit}
      </span>
    </div>
  )
}
