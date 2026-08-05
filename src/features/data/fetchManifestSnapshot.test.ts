import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cacheStorageKey,
  familyPointerCacheKey,
  resourceCacheKey,
  saveCache,
} from './cacheStore'
import { fetchCallGuideManifest, fetchEventCalendarIndex } from './fetchManifest'
import { resetManifestSessionForTests } from './manifestFamily'
import type { CallGuideManifest, EventCalendarIndex, RootManifest } from './types'

const rootUrl = 'https://data.example.test/releases/manifest.json?channel=stable'

function root(dataVersion: string, callGuide = 'call-guide-manifest.json'): RootManifest {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-01T00:00:00.000Z',
    dataVersion,
    manifests: { callGuide, eventCalendar: 'event-calendar/index.json' },
  }
}

function child(dataVersion: string, id = dataVersion): CallGuideManifest {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-01T00:00:00.000Z',
    dataVersion,
    songs: [{
      id: `song-${id}`,
      title: { ko: id },
      artist: { ko: 'artist' },
      youtubeVideoId: 'M7lc1UVf-VE',
      tags: [],
      path: `songs/song-${id}.json`,
      status: 'published',
    }],
  }
}

function calendar(dataVersion: string): EventCalendarIndex {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-01T00:00:00.000Z',
    dataVersion,
    availableMonths: ['2026-06'],
    types: ['concert'],
    typePriority: ['concert'],
  }
}

function response(value: unknown) {
  return { ok: true, json: async () => value }
}

afterEach(() => {
  resetManifestSessionForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('complete manifest family snapshots', () => {
  it('never mixes a newly fetched root with an old-version child', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1'))))
    await fetchCallGuideManifest(rootUrl)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v2')))
      .mockResolvedValueOnce(response(child('v1', 'wrong'))))
    const fallback = await fetchCallGuideManifest(rootUrl)

    expect(fallback.source).toBe('cache')
    expect(fallback.data.dataVersion).toBe('v1')
    expect(fallback.data.songs[0].id).toBe('song-v1')
  })

  it('keeps an independent complete event-calendar root and index family', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(calendar('v1'))))
    await fetchEventCalendarIndex(rootUrl)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v2')))
      .mockResolvedValueOnce(response(calendar('v1'))))
    const fallback = await fetchEventCalendarIndex(rootUrl)

    expect(fallback).toMatchObject({ source: 'cache', data: { dataVersion: 'v1' } })
    expect(window.localStorage.getItem(cacheStorageKey(familyPointerCacheKey(rootUrl, 'event-calendar')))).not.toBeNull()
    expect(window.localStorage.getItem(cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide')))).toBeNull()
  })

  it('updates the family pointer only after root and child cache writes both succeed', async () => {
    const setItem = Storage.prototype.setItem
    let failed = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (!failed && decodeURIComponent(String(key)).includes('/child/')) {
        failed = true
        throw new Error('child write failed')
      }
      return setItem.call(this, key, value)
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1'))))

    const result = await fetchCallGuideManifest(rootUrl)

    expect(result.source).toBe('network')
    expect(window.localStorage.getItem(cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide')))).toBeNull()
  })

  it('keeps the previous same-version snapshot when a changed child path cannot be staged', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1', 'original'))))
    await fetchCallGuideManifest(rootUrl)

    const pointerKey = cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide'))
    const pointerBefore = window.localStorage.getItem(pointerKey)
    const setItem = Storage.prototype.setItem
    let failed = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (!failed && decodeURIComponent(String(key)).includes('/child/')) {
        failed = true
        throw new Error('child stage failed')
      }
      return setItem.call(this, key, value)
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1', 'next-call-guide.json')))
      .mockResolvedValueOnce(response(child('v1', 'discarded-speculation')))
      .mockResolvedValueOnce(response(child('v1', 'replacement'))))

    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({
      source: 'network',
      data: { songs: [{ id: 'song-replacement' }] },
    })
    expect(window.localStorage.getItem(pointerKey)).toBe(pointerBefore)
    expect(window.localStorage.length).toBe(3)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-after-stage-failure')))
    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({
      source: 'cache',
      data: { songs: [{ id: 'song-original' }] },
    })
  })

  it('does not stage a child when the new root write fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1', 'original'))))
    await fetchCallGuideManifest(rootUrl)

    const pointerKey = cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide'))
    const pointerBefore = window.localStorage.getItem(pointerKey)
    const setItem = Storage.prototype.setItem
    const writtenKeys: string[] = []
    let failed = false
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      writtenKeys.push(decodeURIComponent(String(key)))
      if (!failed && decodeURIComponent(String(key)).endsWith('/root')) {
        failed = true
        throw new Error('root stage failed')
      }
      return setItem.call(this, key, value)
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1', 'next-call-guide.json')))
      .mockResolvedValueOnce(response(child('v1', 'discarded-speculation')))
      .mockResolvedValueOnce(response(child('v1', 'replacement'))))

    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({ source: 'network' })
    expect(setItemSpy).toHaveBeenCalledTimes(2)
    expect(writtenKeys.some((key) => key.includes('/child/'))).toBe(false)
    expect(window.localStorage.getItem(pointerKey)).toBe(pointerBefore)
    expect(window.localStorage.length).toBe(3)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-after-root-stage-failure')))
    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({
      source: 'cache',
      data: { songs: [{ id: 'song-original' }] },
    })
  })

  it('uses generation-specific backing keys for same-version snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1', 'original'))))
    await fetchCallGuideManifest(rootUrl)

    const pointerKey = cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide'))
    const firstPointer = JSON.parse(window.localStorage.getItem(pointerKey) ?? '{}').value

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1', 'next-call-guide.json')))
      .mockResolvedValueOnce(response(child('v1', 'discarded-speculation')))
      .mockResolvedValueOnce(response(child('v1', 'replacement'))))
    await fetchCallGuideManifest(rootUrl)

    const secondPointer = JSON.parse(window.localStorage.getItem(pointerKey) ?? '{}').value
    expect(secondPointer.rootKey).not.toBe(firstPointer.rootKey)
    expect(secondPointer.childKey).not.toBe(firstPointer.childKey)
    expect(secondPointer.generation).not.toBe(firstPointer.generation)
  })

  it('keeps the previous snapshot when the pointer switch fails after staging', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1', 'original'))))
    await fetchCallGuideManifest(rootUrl)

    const pointerKey = cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide'))
    const pointerBefore = window.localStorage.getItem(pointerKey)
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === pointerKey) {
        throw new Error('pointer switch failed')
      }
      return setItem.call(this, key, value)
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1', 'next-call-guide.json')))
      .mockResolvedValueOnce(response(child('v1', 'discarded-speculation')))
      .mockResolvedValueOnce(response(child('v1', 'replacement'))))

    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({ source: 'network' })
    expect(window.localStorage.getItem(pointerKey)).toBe(pointerBefore)
    expect(window.localStorage.length).toBe(3)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-after-pointer-failure')))
    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({
      source: 'cache',
      data: { songs: [{ id: 'song-original' }] },
    })
  })

  it('treats a backing get failure as a miss without deleting the valid pointer', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1', 'original'))))
    await fetchCallGuideManifest(rootUrl)

    const pointerKey = cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide'))
    const pointerBefore = window.localStorage.getItem(pointerKey)
    const pointer = JSON.parse(pointerBefore ?? '{}').value
    const rootStorageKey = cacheStorageKey(pointer.rootKey)
    const getItem = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === rootStorageKey) {
        throw new Error('root get failed')
      }
      return getItem.call(this, key)
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-during-get-failure')))

    await expect(fetchCallGuideManifest(rootUrl)).rejects.toThrow('offline-during-get-failure')
    vi.mocked(Storage.prototype.getItem).mockRestore()
    expect(window.localStorage.getItem(pointerKey)).toBe(pointerBefore)
    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({
      source: 'cache',
      data: { songs: [{ id: 'song-original' }] },
    })
  })

  it('re-reads a changed pointer when the generation read by another tab is swept', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1', 'original'))))
    await fetchCallGuideManifest(rootUrl)
    const pointerStorageKey = cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide'))
    const firstPointerRaw = window.localStorage.getItem(pointerStorageKey)!
    const firstPointer = JSON.parse(firstPointerRaw).value
    const firstRootRaw = window.localStorage.getItem(cacheStorageKey(firstPointer.rootKey))!
    const firstChildRaw = window.localStorage.getItem(cacheStorageKey(firstPointer.childKey))!

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v2')))
      .mockResolvedValueOnce(response(child('v2', 'replacement'))))
    await fetchCallGuideManifest(rootUrl)
    const secondPointerRaw = window.localStorage.getItem(pointerStorageKey)!

    window.localStorage.setItem(cacheStorageKey(firstPointer.rootKey), firstRootRaw)
    window.localStorage.setItem(cacheStorageKey(firstPointer.childKey), firstChildRaw)
    window.localStorage.setItem(pointerStorageKey, firstPointerRaw)
    const getItem = Storage.prototype.getItem
    let switched = false
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (!switched && key === cacheStorageKey(firstPointer.rootKey)) {
        switched = true
        this.setItem(pointerStorageKey, secondPointerRaw)
        this.removeItem(cacheStorageKey(firstPointer.rootKey))
        this.removeItem(cacheStorageKey(firstPointer.childKey))
        return null
      }
      return getItem.call(this, key)
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-during-pointer-race')))

    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({
      source: 'cache',
      data: { songs: [{ id: 'song-replacement' }] },
    })
    expect(switched).toBe(true)
  })

  it('keeps the new pointer loadable when old-generation cleanup throws', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1', 'original'))))
    await fetchCallGuideManifest(rootUrl)

    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('cleanup failed')
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1', 'next-call-guide.json')))
      .mockResolvedValueOnce(response(child('v1', 'discarded-speculation')))
      .mockResolvedValueOnce(response(child('v1', 'replacement'))))
    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({ source: 'network' })

    expect(removeItem).toHaveBeenCalled()
    removeItem.mockRestore()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-after-cleanup-failure')))
    await expect(fetchCallGuideManifest(rootUrl)).resolves.toMatchObject({
      source: 'cache',
      data: { songs: [{ id: 'song-replacement' }] },
    })
  })

  it('does not remove a legacy root still referenced by the other manifest family', async () => {
    const legacyRoot = root('v1')
    const legacyRootKey = resourceCacheKey(rootUrl, 'v1', '@root')
    const legacyCallGuideKey = resourceCacheKey(rootUrl, 'v1', legacyRoot.manifests.callGuide)
    const legacyCalendarKey = resourceCacheKey(rootUrl, 'v1', legacyRoot.manifests.eventCalendar)
    saveCache(legacyRootKey, legacyRoot)
    saveCache(legacyCallGuideKey, child('v1', 'original'))
    saveCache(legacyCalendarKey, calendar('v1'))
    saveCache(familyPointerCacheKey(rootUrl, 'call-guide'), {
      childKey: legacyCallGuideKey,
      childUrl: new URL(legacyRoot.manifests.callGuide, rootUrl).toString(),
      dataVersion: 'v1',
      rootKey: legacyRootKey,
      rootUrl,
    })
    saveCache(familyPointerCacheKey(rootUrl, 'event-calendar'), {
      childKey: legacyCalendarKey,
      childUrl: new URL(legacyRoot.manifests.eventCalendar, rootUrl).toString(),
      dataVersion: 'v1',
      rootKey: legacyRootKey,
      rootUrl,
    })

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1', 'next-call-guide.json')))
      .mockResolvedValueOnce(response(child('v1', 'discarded-speculation')))
      .mockResolvedValueOnce(response(child('v1', 'replacement'))))
    await fetchCallGuideManifest(rootUrl)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('calendar-offline-after-call-guide-migration')))
    await expect(fetchEventCalendarIndex(rootUrl)).resolves.toMatchObject({
      source: 'cache',
      data: { dataVersion: 'v1' },
    })
  })

  it('keeps the prior complete pointer when a partial refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1'))))
    await fetchCallGuideManifest(rootUrl)
    const pointerKey = cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide'))
    const pointerBefore = window.localStorage.getItem(pointerKey)

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v2')))
      .mockRejectedValueOnce(new Error('child offline')))
    const fallback = await fetchCallGuideManifest(rootUrl)

    expect(fallback.source).toBe('cache')
    expect(fallback.data.dataVersion).toBe('v1')
    expect(window.localStorage.getItem(pointerKey)).toBe(pointerBefore)
  })

  it.each(['rootKey', 'childKey'] as const)('rejects a family pointer with a forged %s', async (field) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1'))))
    await fetchCallGuideManifest(rootUrl)
    const pointerStorageKey = cacheStorageKey(familyPointerCacheKey(rootUrl, 'call-guide'))
    const envelope = JSON.parse(window.localStorage.getItem(pointerStorageKey) ?? '{}')
    const rogueKey = resourceCacheKey(rootUrl, 'v1', field === 'rootKey' ? 'rogue-root.json' : 'rogue-child.json')
    saveCache(rogueKey, field === 'rootKey' ? root('v1') : child('v1', 'rogue'))
    envelope.value[field] = rogueKey
    window.localStorage.setItem(pointerStorageKey, JSON.stringify(envelope))

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline-forged-pointer')))
    await expect(fetchCallGuideManifest(rootUrl)).rejects.toThrow('offline-forged-pointer')
  })

  it('uses a stale snapshot after 24h with a warning and rejects it after 30d', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(root('v1')))
      .mockResolvedValueOnce(response(child('v1'))))
    await fetchCallGuideManifest(rootUrl)

    vi.setSystemTime(new Date('2026-07-02T00:00:00.001Z'))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const stale = await fetchCallGuideManifest(rootUrl)
    expect(stale.source).toBe('cache')
    expect(stale.warning).toMatch(/오래된|stale/i)

    vi.setSystemTime(new Date('2026-07-31T00:00:00.001Z'))
    await expect(fetchCallGuideManifest(rootUrl)).rejects.toThrow('offline')
  })
})
