import { describe, expect, it, vi } from 'vitest'
import { isCatalogRootHash, preloadInitialCatalogRoute } from './preloadCatalogRoute'

function navigatorWithSaveData(saveData: boolean): Navigator & {
  connection: { saveData: boolean }
} {
  return { connection: { saveData } } as Navigator & { connection: { saveData: boolean } }
}

describe('catalog route preload', () => {
  it.each(['', '#', '#/', '#/?mode=dark'])('recognizes catalog root hash %s', (hash) => {
    expect(isCatalogRootHash(hash)).toBe(true)
  })

  it.each(['#/events', '#/songs/example', '#/missing'])('rejects non-catalog hash %s', (hash) => {
    expect(isCatalogRootHash(hash)).toBe(false)
  })

  it('starts the route chunk at catalog root and swallows speculative failures', async () => {
    const loadRoute = vi.fn(() => Promise.reject(new Error('offline')))

    preloadInitialCatalogRoute({
      hash: '#/',
      loadRoute,
      navigatorValue: navigatorWithSaveData(false),
    })

    expect(loadRoute).toHaveBeenCalledTimes(1)
    await Promise.resolve()
  })

  it('skips preload for data saver and direct lazy routes', () => {
    const loadRoute = vi.fn(() => Promise.resolve({ CatalogPage: () => null }))

    preloadInitialCatalogRoute({
      hash: '#/',
      loadRoute,
      navigatorValue: navigatorWithSaveData(true),
    })
    preloadInitialCatalogRoute({
      hash: '#/events',
      loadRoute,
      navigatorValue: navigatorWithSaveData(false),
    })

    expect(loadRoute).not.toHaveBeenCalled()
  })
})
