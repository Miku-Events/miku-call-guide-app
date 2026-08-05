import { describe, expect, it, vi } from 'vitest'
import { createSharedResourceStore } from './sharedResourceStore'

describe('createSharedResourceStore', () => {
  it('shares a healthy task and force only bypasses completed values', async () => {
    let resolve!: (value: string) => void
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done }))
    const store = createSharedResourceStore<string>({ completedLimit: 1 })
    const first = store.acquire('key', { load })
    const forcedPending = store.acquire('key', { force: true, load })
    resolve('value')
    await expect(Promise.all([first, forcedPending])).resolves.toEqual(['value', 'value'])
    await expect(store.acquire('key', { load })).resolves.toBe('value')
    expect(load).toHaveBeenCalledOnce()
    await store.acquire('key', { force: true, load: async () => 'new' })
    expect(load).toHaveBeenCalledOnce()
  })

  it('aborts only after the last consumer leaves and allows a microtask handoff', async () => {
    const store = createSharedResourceStore<string>()
    let sharedSignal!: AbortSignal
    const load = (signal: AbortSignal) => {
      sharedSignal = signal
      return new Promise<string>(() => undefined)
    }
    const firstController = new AbortController()
    const first = store.acquire('key', { load, signal: firstController.signal })
    firstController.abort()
    const secondController = new AbortController()
    const second = store.acquire('key', { load, signal: secondController.signal })
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(sharedSignal.aborted).toBe(false)
    secondController.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(sharedSignal.aborted).toBe(true)
  })

  it('keeps retained prefetch alive and evicts completed values by LRU', async () => {
    const store = createSharedResourceStore<string>({ completedLimit: 2 })
    await store.acquire('a', { load: async () => 'a', retain: true })
    await store.acquire('b', { load: async () => 'b', retain: true })
    await store.acquire('a', { load: async () => 'unused' })
    await store.acquire('c', { load: async () => 'c', retain: true })
    expect(store.snapshot()).toEqual({ completed: 2, pending: 0 })
    await expect(store.acquire('a', { load: async () => 'unused' })).resolves.toBe('a')
    await expect(store.acquire('b', { load: async () => 'reloaded' })).resolves.toBe('reloaded')
  })
})
