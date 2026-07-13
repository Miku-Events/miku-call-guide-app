import { useSyncExternalStore } from 'react'
import { formatMs } from '../../shared/time/formatTime'
import type { PlaybackTimeStore } from './playbackTimeStore'

interface PlaybackClockProps {
  active: boolean
  store: PlaybackTimeStore
}

export function PlaybackClock({ active, store }: PlaybackClockProps) {
  const currentMs = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return <p className="m-0">{active ? formatMs(currentMs) : '0:00.0'}</p>
}
