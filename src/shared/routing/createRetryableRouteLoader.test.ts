import { describe, expect, it, vi } from 'vitest'
import { createRetryableRouteLoader } from './createRetryableRouteLoader'

describe('createRetryableRouteLoader', () => {
  it('shares a successful route import for the lifetime of the tab', async () => {
    const module = { route: 'catalog' }
    const importer = vi.fn(() => Promise.resolve(module))
    const load = createRetryableRouteLoader(importer)

    const first = load()
    const second = load()

    expect(first).toBe(second)
    await expect(first).resolves.toBe(module)
    await expect(load()).resolves.toBe(module)
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('clears a rejected import so a later render can retry', async () => {
    const module = { route: 'catalog' }
    const importer = vi.fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce(module)
    const load = createRetryableRouteLoader(importer)

    await expect(load()).rejects.toThrow('chunk unavailable')
    await expect(load()).resolves.toBe(module)
    expect(importer).toHaveBeenCalledTimes(2)
  })
})
