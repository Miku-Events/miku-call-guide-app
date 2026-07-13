export interface PlaybackTimeStore {
  getSnapshot: () => number
  set: (timeMs: number) => void
  subscribe: (listener: () => void) => () => void
}

export function createPlaybackTimeStore(initialTimeMs = 0): PlaybackTimeStore {
  let currentTimeMs = initialTimeMs
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => currentTimeMs,
    set: (timeMs) => {
      if (Object.is(currentTimeMs, timeMs)) {
        return
      }

      currentTimeMs = timeMs
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
