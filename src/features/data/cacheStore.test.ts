import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CACHE_FRESH_MS,
  CACHE_MAX_STALE_MS,
  cacheStorageKey,
  familyPointerCacheKey,
  loadCache,
  normalizeManifestIdentity,
  resourceCacheKey,
  saveCache,
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
})
