import { describe, expect, it, vi } from 'vitest'
import { createPlaybackTimeStore } from './playbackTimeStore'

describe('createPlaybackTimeStore', () => {
  it('publishes clock samples without requiring React parent state', () => {
    const store = createPlaybackTimeStore(0)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set(100)
    store.set(200)
    store.set(200)

    expect(store.getSnapshot()).toBe(200)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    store.set(300)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
