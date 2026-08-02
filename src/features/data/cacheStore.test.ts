import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CACHE_FRESH_MS,
  CACHE_MAX_STALE_MS,
  CACHE_NAMESPACE_MAX_BYTES,
  cacheNamespaceBytes,
  cacheStorageKey,
  familyPointerCacheKey,
  loadCache,
  normalizeManifestIdentity,
  resourceCacheKey,
  saveCache,
  sweepCache,
} from './cacheStore'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('cacheStore', () => {
  it('normalizes manifest identity and namespaces origin, root path, version, and resource', () => {
    expect(normalizeManifestIdentity('https://data.example.test/releases/manifest.json?z=2&a=1#ignored')).toBe(
      'https://data.example.test/releases/manifest.json?a=1&z=2',
    )

    const baseline = resourceCacheKey('https://data.example.test/releases/manifest.json?z=2&a=1', 'v1', 'songs/a.json')
    expect(baseline).toBe(resourceCacheKey('https://data.example.test/releases/manifest.json?a=1&z=2', 'v1', 'songs/a.json'))
    expect(new Set([
      baseline,
      resourceCacheKey('https://mirror.example.test/releases/manifest.json?a=1&z=2', 'v1', 'songs/a.json'),
      resourceCacheKey('https://data.example.test/other/manifest.json?a=1&z=2', 'v1', 'songs/a.json'),
      resourceCacheKey('https://data.example.test/releases/manifest.json?a=1&z=2', 'v2', 'songs/a.json'),
      resourceCacheKey('https://data.example.test/releases/manifest.json?a=1&z=2', 'v1', 'songs/b.json'),
    ]).size).toBe(5)
    expect(familyPointerCacheKey('https://data.example.test/releases/manifest.json', 'call-guide')).not.toBe(
      familyPointerCacheKey('https://data.example.test/releases/manifest.json', 'event-calendar'),
    )
  })

  it('canonicalizes distinct query keys without reordering duplicate values', () => {
    const stableFirst = 'https://data.example.test/manifest.json?z=2&channel=stable&channel=preview&a=1'
    const previewFirst = 'https://data.example.test/manifest.json?a=1&channel=preview&channel=stable&z=2'

    expect(normalizeManifestIdentity(stableFirst)).toBe(
      'https://data.example.test/manifest.json?a=1&channel=stable&channel=preview&z=2',
    )
    expect(normalizeManifestIdentity(previewFirst)).toBe(
      'https://data.example.test/manifest.json?a=1&channel=preview&channel=stable&z=2',
    )
    expect(normalizeManifestIdentity(stableFirst)).not.toBe(normalizeManifestIdentity(previewFirst))
    expect(resourceCacheKey(stableFirst, 'v1', 'songs/a.json')).not.toBe(
      resourceCacheKey(previewFirst, 'v1', 'songs/a.json'),
    )
  })

  it('classifies <=24h as fresh, <=30d as stale, and removes older entries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'))
    expect(saveCache('ttl', { ok: true })).toBe(true)

    vi.setSystemTime(new Date(Date.now() + CACHE_FRESH_MS))
    expect(loadCache<{ ok: boolean }>('ttl')?.freshness).toBe('fresh')

    vi.setSystemTime(new Date(Date.now() + 1))
    expect(loadCache<{ ok: boolean }>('ttl')?.freshness).toBe('stale')

    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z').getTime() + CACHE_MAX_STALE_MS + 1)
    expect(loadCache('ttl')).toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey('ttl'))).toBeNull()
  })

  it('removes a cache envelope saved in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'))
    window.localStorage.setItem(cacheStorageKey('future'), JSON.stringify({
      savedAt: '2099-01-01T00:00:00.000Z',
      value: { old: true },
    }))

    expect(loadCache('future')).toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey('future'))).toBeNull()
  })

  it('treats localStorage property, get, set, remove, parse, and stringify failures as cache misses', () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(loadCache('blocked')).toBeNull()
    expect(saveCache('blocked', { ok: true })).toBe(false)
    getter.mockRestore()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('get failed')
    })
    expect(loadCache('get')).toBeNull()

    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('set failed')
    })
    expect(saveCache('set', { ok: true })).toBe(false)

    window.localStorage.setItem(cacheStorageKey('parse'), '{not json')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementationOnce(() => {
      throw new Error('remove failed')
    })
    expect(loadCache('parse')).toBeNull()

    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(saveCache('stringify', circular)).toBe(false)
  })

  it('sweeps expired, previous-version, and orphan resources while protecting a valid family snapshot', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'))
    const rootUrl = 'https://data.example.test/manifest.json'
    const generation = '0123456789abcdef0123456789abcdef'
    const rootKey = resourceCacheKey(rootUrl, 'v1', `@family-snapshot/call-guide/${generation}/root`)
    const childKey = resourceCacheKey(rootUrl, 'v1', `@family-snapshot/call-guide/${generation}/child/call-guide-manifest.json`)
    const pointerKey = familyPointerCacheKey(rootUrl, 'call-guide')
    saveCache(rootKey, {
      dataVersion: 'v1',
      manifests: {
        callGuide: 'call-guide-manifest.json',
        eventCalendar: 'event-calendar/index.json',
      },
    }, { protectKeys: [rootKey] })
    saveCache(childKey, { dataVersion: 'v1' }, { protectKeys: [rootKey, childKey] })
    saveCache(pointerKey, {
      childKey,
      childUrl: 'https://data.example.test/call-guide-manifest.json',
      dataVersion: 'v1',
      generation,
      rootKey,
      rootUrl,
    }, { protectKeys: [pointerKey, rootKey, childKey] })
    const oldLeaf = resourceCacheKey(rootUrl, 'v1', 'songs/old.json')
    const orphan = resourceCacheKey(rootUrl, 'v2', '@family-snapshot/call-guide/fedcba9876543210fedcba9876543210/root')
    const currentLeaf = resourceCacheKey(rootUrl, 'v2', 'songs/current.json')
    saveCache(oldLeaf, { dataVersion: 'v1' })
    saveCache(orphan, { dataVersion: 'v2' })
    saveCache(currentLeaf, { dataVersion: 'v2' })
    const expired = resourceCacheKey(rootUrl, 'v2', 'songs/expired.json')
    window.localStorage.setItem(cacheStorageKey(expired), JSON.stringify({
      savedAt: new Date(Date.now() - CACHE_MAX_STALE_MS - 1).toISOString(),
      value: { expired: true },
    }))

    sweepCache({ currentDataVersion: 'v2' })

    expect(window.localStorage.getItem(cacheStorageKey(rootKey))).not.toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(childKey))).not.toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(pointerKey))).not.toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(currentLeaf))).not.toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(oldLeaf))).toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(orphan))).toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(expired))).toBeNull()
  })

  it('preserves non-cache application state that shares the app storage prefix', () => {
    const disclaimerKey = 'miku-call-guide:spoiler-disclaimer-acknowledged'
    window.localStorage.setItem(disclaimerKey, '1')

    sweepCache({ currentDataVersion: 'v2' })

    expect(window.localStorage.getItem(disclaimerKey)).toBe('1')
    expect(cacheNamespaceBytes()).toBe(0)
  })

  it('does not protect a forged family pointer or backing keys outside its generation namespace', () => {
    const rootUrl = 'https://data.example.test/manifest.json'
    const generation = 'fedcba9876543210fedcba9876543210'
    const forgedRootKey = resourceCacheKey(
      rootUrl,
      'v2',
      `@family-snapshot/call-guide/${generation}/rogue-root`,
    )
    const childKey = resourceCacheKey(
      rootUrl,
      'v2',
      `@family-snapshot/call-guide/${generation}/child/call-guide-manifest.json`,
    )
    const pointerKey = familyPointerCacheKey(rootUrl, 'call-guide')
    saveCache(forgedRootKey, {
      dataVersion: 'v2',
      manifests: {
        callGuide: 'call-guide-manifest.json',
        eventCalendar: 'event-calendar/index.json',
      },
    }, { protectKeys: [forgedRootKey] })
    saveCache(childKey, { dataVersion: 'v2' }, {
      protectKeys: [forgedRootKey, childKey],
    })
    window.localStorage.setItem(cacheStorageKey(pointerKey), JSON.stringify({
      savedAt: new Date().toISOString(),
      value: {
        childKey,
        childUrl: 'https://data.example.test/call-guide-manifest.json',
        dataVersion: 'v2',
        generation,
        rootKey: forgedRootKey,
        rootUrl,
      },
    }))
    expect(window.localStorage.getItem(cacheStorageKey(pointerKey))).not.toBeNull()

    sweepCache({ currentDataVersion: 'v2' })

    expect(window.localStorage.getItem(cacheStorageKey(pointerKey))).toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(forgedRootKey))).toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(childKey))).toBeNull()
  })

  it('keeps successful saves below 4 MiB by reserving the pending payload and removing the oldest leaf', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'))
    const rootUrl = 'https://data.example.test/manifest.json'
    const rootKey = resourceCacheKey(rootUrl, 'v2', '@root')
    const childKey = resourceCacheKey(rootUrl, 'v2', 'call-guide-manifest.json')
    const pointerKey = familyPointerCacheKey(rootUrl, 'call-guide')
    saveCache(rootKey, {
      dataVersion: 'v2',
      manifests: {
        callGuide: 'call-guide-manifest.json',
        eventCalendar: 'event-calendar/index.json',
      },
    }, { protectKeys: [rootKey] })
    saveCache(childKey, { dataVersion: 'v2' }, { protectKeys: [rootKey, childKey] })
    saveCache(pointerKey, {
      childKey,
      childUrl: 'https://data.example.test/call-guide-manifest.json',
      dataVersion: 'v2',
      rootKey,
      rootUrl,
    }, { protectKeys: [pointerKey, rootKey, childKey] })
    const oldest = resourceCacheKey(rootUrl, 'v2', 'songs/oldest.json')
    const newest = resourceCacheKey(rootUrl, 'v2', 'songs/newest.json')
    saveCache(oldest, 'a'.repeat(1_100_000))
    vi.setSystemTime(new Date('2026-08-01T00:00:01.000Z'))
    saveCache(newest, 'b'.repeat(1_100_000))

    expect(cacheNamespaceBytes()).toBeLessThanOrEqual(CACHE_NAMESPACE_MAX_BYTES)
    expect(window.localStorage.getItem(cacheStorageKey(oldest))).toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(newest))).not.toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(pointerKey))).not.toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(rootKey))).not.toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(childKey))).not.toBeNull()
  })

  it('sweeps and retries exactly once after a quota write failure', () => {
    const rootUrl = 'https://data.example.test/manifest.json'
    const obsolete = resourceCacheKey(rootUrl, 'v1', 'songs/obsolete.json')
    saveCache(obsolete, { old: true })
    const setItem = Storage.prototype.setItem
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError') })
      .mockImplementation(function (key, value) { return setItem.call(this, key, value) })

    const current = resourceCacheKey(rootUrl, 'v2', 'songs/current.json')
    expect(saveCache(current, { current: true }, { currentDataVersion: 'v2' })).toBe(true)

    expect(setItemSpy).toHaveBeenCalledTimes(2)
    expect(window.localStorage.getItem(cacheStorageKey(obsolete))).toBeNull()
    expect(loadCache(current)?.value).toEqual({ current: true })
  })

  it('does not retry a quota failure more than once', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(saveCache('never-written', { ok: false })).toBe(false)
    expect(setItemSpy).toHaveBeenCalledTimes(2)
  })
})
