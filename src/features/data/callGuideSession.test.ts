import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  callGuideSessionSnapshotForTests,
  loadCallGuideManifest,
  loadCallGuideSong,
  prefetchCallGuideManifest,
  prefetchCallGuideSong,
  resetCallGuideSessionForTests,
} from './callGuideSession'
import type { CallGuideManifest, RootManifest, SongGuide } from './types'

const rootUrl = 'https://data.example.test/manifest.json'

function root(dataVersion = 'v1', callGuide = 'call-guide-manifest.json'): RootManifest {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    dataVersion,
    manifests: { callGuide, eventCalendar: 'event-calendar/index.json' },
  }
}

function manifest(ids: string[], dataVersion = 'v1'): CallGuideManifest {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    dataVersion,
    songs: ids.map((id) => ({
      id,
      title: { ko: id },
      artist: { ko: 'artist' },
      youtubeVideoId: 'M7lc1UVf-VE',
      tags: [],
      path: `songs/${id}.json`,
      status: 'published',
    })),
  }
}

function song(id: string, dataVersion = 'v1'): SongGuide {
  return {
    schemaVersion: 1,
    dataVersion,
    id,
    status: 'published',
    metadata: {
      title: { ko: id },
      artist: { ko: 'artist' },
      vocal: ['hatsune-miku'],
      tags: [],
    },
    youtube: { videoId: 'M7lc1UVf-VE', startOffsetMs: 0 },
    display: {
      defaultLyricsLanguage: 'ja',
      defaultPronunciationLanguage: 'koPronunciation',
      defaultCallLanguage: 'ko',
    },
    timing: { unit: 'ms', durationMs: 1000 },
    lyrics: [{
      id: 'line-1',
      time: '00:00:00,000 --> 00:00:01,000',
      startMs: 0,
      endMs: 1000,
      text: { ja: id, koPronunciation: id },
    }],
    callEvents: [],
  }
}

function response(value: unknown) {
  return { ok: true, json: async () => value }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

afterEach(() => {
  resetCallGuideSessionForTests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('callGuideSession', () => {
  it('returns a rejected Promise for an empty root URL without throwing synchronously', async () => {
    let request: ReturnType<typeof loadCallGuideManifest> | undefined

    expect(() => {
      request = loadCallGuideManifest('')
    }).not.toThrow()
    await expect(request!).rejects.toThrow('VITE_DATA_MANIFEST_URL is not configured.')
  })

  it('starts the default child alongside the root and keeps the completed manifest for the tab', async () => {
    const rootResponse = deferred<ReturnType<typeof response>>()
    const childResponse = deferred<ReturnType<typeof response>>()
    const fetchMock = vi.fn((url: string) => (
      url === rootUrl ? rootResponse.promise : childResponse.promise
    ))
    vi.stubGlobal('fetch', fetchMock)

    const first = loadCallGuideManifest(rootUrl)
    await Promise.resolve()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      rootUrl,
      'https://data.example.test/call-guide-manifest.json',
    ])

    rootResponse.resolve(response(root()))
    childResponse.resolve(response(manifest(['song-a'])))
    const result = await first
    expect(result).toMatchObject({ source: 'network', data: { dataVersion: 'v1' } })

    await expect(loadCallGuideManifest(rootUrl)).resolves.toBe(result)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('discards a speculative default child and loads the root-declared alternate path', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === rootUrl) return Promise.resolve(response(root('v1', 'catalog/calls.json')))
      if (url.endsWith('/call-guide-manifest.json')) return Promise.resolve(response(manifest(['discarded'])))
      return Promise.resolve(response(manifest(['declared'])))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await loadCallGuideManifest(rootUrl)

    expect(result.data.songs[0].id).toBe('declared')
    expect(result.url).toBe('https://data.example.test/catalog/calls.json')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      rootUrl,
      'https://data.example.test/call-guide-manifest.json',
      'https://data.example.test/catalog/calls.json',
    ])
  })

  it('revalidates the declared child once after a speculative version mismatch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(root('v2')))
      .mockResolvedValueOnce(response(manifest(['stale'], 'v1')))
      .mockResolvedValueOnce(response(manifest(['current'], 'v2')))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadCallGuideManifest(rootUrl)).resolves.toMatchObject({
      data: { dataVersion: 'v2', songs: [{ id: 'current' }] },
      source: 'network',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('lets one manifest consumer abort without cancelling the shared request', async () => {
    const rootResponse = deferred<ReturnType<typeof response>>()
    const childResponse = deferred<ReturnType<typeof response>>()
    const underlyingSignals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
      underlyingSignals.push(options.signal as AbortSignal)
      return url === rootUrl ? rootResponse.promise : childResponse.promise
    }))
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = loadCallGuideManifest(rootUrl, { signal: firstController.signal })
    const second = loadCallGuideManifest(rootUrl, { signal: secondController.signal })
    await Promise.resolve()
    firstController.abort(new DOMException('left route', 'AbortError'))

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(underlyingSignals.every((signal) => !signal.aborted)).toBe(true)
    rootResponse.resolve(response(root()))
    childResponse.resolve(response(manifest(['song-a'])))
    await expect(second).resolves.toMatchObject({ source: 'network' })
  })

  it('aborts root and child after the final normal consumer leaves for a microtask', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      const signal = options.signal as AbortSignal
      signals.push(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }))
    const controller = new AbortController()
    const request = loadCallGuideManifest(rootUrl, { signal: controller.signal })
    await Promise.resolve()
    controller.abort(new DOMException('left route', 'AbortError'))
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('starts a fresh manifest task when a consumer attaches during aborted-task cleanup', async () => {
    let initialCalls = 0
    let replacement: ReturnType<typeof loadCallGuideManifest> | undefined
    vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
      if (initialCalls < 2) {
        initialCalls += 1
        const signal = options.signal as AbortSignal
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            if (url === rootUrl) {
              replacement = loadCallGuideManifest(rootUrl)
            }
            reject(signal.reason)
          }, { once: true })
        })
      }
      return Promise.resolve(response(url === rootUrl ? root() : manifest(['replacement'])))
    }))
    const controller = new AbortController()
    const abandoned = loadCallGuideManifest(rootUrl, { signal: controller.signal })
    await Promise.resolve()

    controller.abort(new DOMException('left route', 'AbortError'))
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    expect(replacement).toBeDefined()
    await expect(replacement!).resolves.toMatchObject({
      data: { songs: [{ id: 'replacement' }] },
      source: 'network',
    })
  })

  it('prioritizes a pending forced manifest refresh for normal and retained consumers', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(
      url === rootUrl ? root() : manifest(['cached']),
    ))))
    const cached = await loadCallGuideManifest(rootUrl)
    const rootResponse = deferred<ReturnType<typeof response>>()
    const childResponse = deferred<ReturnType<typeof response>>()
    const refreshFetch = vi.fn((url: string) => (
      url === rootUrl ? rootResponse.promise : childResponse.promise
    ))
    vi.stubGlobal('fetch', refreshFetch)

    const forced = loadCallGuideManifest(rootUrl, { force: true })
    await Promise.resolve()
    const normal = loadCallGuideManifest(rootUrl)
    const retained = prefetchCallGuideManifest(rootUrl)
    rootResponse.resolve(response(root('v2')))
    childResponse.resolve(response(manifest(['refreshed'], 'v2')))

    const refreshed = await forced
    expect(refreshed).not.toBe(cached)
    await expect(normal).resolves.toBe(refreshed)
    await expect(retained).resolves.toBeUndefined()
    expect(refreshFetch).toHaveBeenCalledTimes(2)
  })

  it('shares a retained prefetch with a route request and stores five completed songs by LRU', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const fetchMock = vi.fn((url: string) => {
      if (url === rootUrl) return Promise.resolve(response(root()))
      if (url.endsWith('/call-guide-manifest.json')) return Promise.resolve(response(manifest(ids)))
      const id = new URL(url).pathname.split('/').at(-1)?.replace('.json', '') ?? ''
      return Promise.resolve(response(song(id)))
    })
    vi.stubGlobal('fetch', fetchMock)
    const loadedManifest = await loadCallGuideManifest(rootUrl)
    const entryA = loadedManifest.data.songs[0]

    await Promise.all([
      prefetchCallGuideSong(rootUrl, 'a'),
      loadCallGuideSong(loadedManifest, entryA),
    ])
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/songs/a.json'))).toHaveLength(1)

    for (const id of ids.slice(1)) {
      const entry = loadedManifest.data.songs.find((item) => item.id === id)!
      await loadCallGuideSong(loadedManifest, entry)
    }
    expect(callGuideSessionSnapshotForTests().songs).toBe(5)

    await loadCallGuideSong(loadedManifest, entryA)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/songs/a.json'))).toHaveLength(2)
  })

  it('lets an already-started retained prefetch finish after its route consumer aborts', async () => {
    const leafResponse = deferred<ReturnType<typeof response>>()
    let leafSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
      if (url === rootUrl) return Promise.resolve(response(root()))
      if (url.endsWith('/call-guide-manifest.json')) return Promise.resolve(response(manifest(['a'])))
      leafSignal = options.signal as AbortSignal
      return leafResponse.promise
    }))
    const loadedManifest = await loadCallGuideManifest(rootUrl)
    const entry = loadedManifest.data.songs[0]
    const prefetch = prefetchCallGuideSong(rootUrl, 'a')
    const controller = new AbortController()
    const route = loadCallGuideSong(loadedManifest, entry, { signal: controller.signal })
    await Promise.resolve()

    controller.abort(new DOMException('route changed', 'AbortError'))
    await expect(route).rejects.toMatchObject({ name: 'AbortError' })
    expect(leafSignal?.aborted).toBe(false)
    leafResponse.resolve(response(song('a')))
    await expect(prefetch).resolves.toBeUndefined()
    expect(callGuideSessionSnapshotForTests().songs).toBe(1)
  })

  it('starts a fresh song task when a consumer attaches during aborted-task cleanup', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === rootUrl) return Promise.resolve(response(root()))
      return Promise.resolve(response(manifest(['a'])))
    }))
    const loadedManifest = await loadCallGuideManifest(rootUrl)
    const entry = loadedManifest.data.songs[0]
    let leafCalls = 0
    let replacement: ReturnType<typeof loadCallGuideSong> | undefined
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
      leafCalls += 1
      if (leafCalls > 1) {
        return Promise.resolve(response(song('a')))
      }
      const signal = options.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          replacement = loadCallGuideSong(loadedManifest, entry)
          reject(signal.reason)
        }, { once: true })
      })
    }))
    const controller = new AbortController()
    const abandoned = loadCallGuideSong(loadedManifest, entry, { signal: controller.signal })
    await Promise.resolve()

    controller.abort(new DOMException('left route', 'AbortError'))
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    expect(replacement).toBeDefined()
    await expect(replacement!).resolves.toMatchObject({ data: { id: 'a' }, source: 'network' })
    expect(leafCalls).toBe(2)
  })

  it('prioritizes a pending forced song refresh for normal and retained consumers', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === rootUrl) return Promise.resolve(response(root()))
      if (url.endsWith('/call-guide-manifest.json')) return Promise.resolve(response(manifest(['a'])))
      return Promise.resolve(response(song('a')))
    }))
    const loadedManifest = await loadCallGuideManifest(rootUrl)
    const entry = loadedManifest.data.songs[0]
    const cached = await loadCallGuideSong(loadedManifest, entry)
    const leafResponse = deferred<ReturnType<typeof response>>()
    const refreshFetch = vi.fn(() => leafResponse.promise)
    vi.stubGlobal('fetch', refreshFetch)

    const forced = loadCallGuideSong(loadedManifest, entry, { force: true })
    await Promise.resolve()
    const normal = loadCallGuideSong(loadedManifest, entry)
    const retained = prefetchCallGuideSong(rootUrl, 'a')
    await Promise.resolve()
    leafResponse.resolve(response(song('a')))

    const refreshed = await forced
    expect(refreshed).not.toBe(cached)
    await expect(normal).resolves.toBe(refreshed)
    await expect(retained).resolves.toBeUndefined()
    expect(refreshFetch).toHaveBeenCalledOnce()
  })

  it('skips all manifest and song data prefetch when saveData is enabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { connection: { saveData: true } })

    await prefetchCallGuideSong(rootUrl, 'a')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(callGuideSessionSnapshotForTests()).toEqual({
      manifests: 0,
      pendingManifests: 0,
      pendingSongs: 0,
      songs: 0,
    })
  })

  it('bypasses completed song data only for an explicit forced retry', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === rootUrl) return Promise.resolve(response(root()))
      if (url.endsWith('/call-guide-manifest.json')) return Promise.resolve(response(manifest(['a'])))
      return Promise.resolve(response(song('a')))
    })
    vi.stubGlobal('fetch', fetchMock)
    const loadedManifest = await loadCallGuideManifest(rootUrl)
    const entry = loadedManifest.data.songs[0]

    const first = await loadCallGuideSong(loadedManifest, entry)
    await expect(loadCallGuideSong(loadedManifest, entry)).resolves.toBe(first)
    await loadCallGuideSong(loadedManifest, entry, { force: true })

    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/songs/a.json'))).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === rootUrl)).toHaveLength(1)
  })
})
