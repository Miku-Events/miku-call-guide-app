import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheStorageKey, resourceCacheKey } from './cacheStore'
import {
  fetchCallGuideManifest,
  fetchEventCalendarIndex,
  fetchEventCalendarMonth,
  fetchEventDetail,
} from './fetchManifest'
import type { CallGuideManifest, EventCalendarIndex, EventCalendarMonth, EventGuide, RootManifest } from './types'

const rootManifest: RootManifest = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'test',
  manifests: {
    callGuide: 'call-guide-manifest.json',
    eventCalendar: 'event-calendar/index.json',
  },
}

const callGuideManifest: CallGuideManifest = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'test',
  songs: [],
}

const eventIndex: EventCalendarIndex = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'test',
  availableMonths: ['2026-06'],
  types: ['concert'],
  typePriority: ['concert', 'popup'],
}

const month: EventCalendarMonth = {
  schemaVersion: 1,
  generatedAt: '2026-05-18T00:00:00.000Z',
  dataVersion: 'test',
  month: '2026-06',
  events: [
    {
      id: 'sample-event',
      title: { ko: '샘플 이벤트' },
      type: 'concert',
      occurrences: [{ id: 'day-1', startsAt: '2026-06-15T18:00:00+09:00', timezone: 'Asia/Seoul' }],
      path: '../events/sample-event.json',
    },
  ],
}

const eventDetail: EventGuide = {
  schemaVersion: 1,
  dataVersion: 'test',
  id: 'sample-event',
  status: 'published',
  title: { ko: '샘플 이벤트' },
  type: 'concert',
  occurrences: month.events[0].occurrences,
  links: { sns: [{ platform: 'x', url: 'https://x.com/example/status/123' }] },
}

function withoutDataVersion<T extends { dataVersion: string }>(value: T): Partial<T> {
  const result: Partial<T> = { ...value }
  delete result.dataVersion
  return result
}

describe('fetch manifest helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('loads root and call-guide manifests from network and writes cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => rootManifest })
        .mockResolvedValueOnce({ ok: true, json: async () => callGuideManifest }),
    )

    const result = await fetchCallGuideManifest('https://example.test/manifest.json')

    expect(result.source).toBe('network')
    expect(result.url).toBe('https://example.test/call-guide-manifest.json')
    expect(result.data.dataVersion).toBe('test')
    expect(window.localStorage.length).toBe(3)
  })

  it('falls back to the last successful call-guide manifest cache when the child manifest fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => rootManifest })
      .mockResolvedValueOnce({ ok: true, json: async () => callGuideManifest }))
    await fetchCallGuideManifest('https://example.test/manifest.json')
    const offlineFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => rootManifest })
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', offlineFetch)
    const result = await fetchCallGuideManifest('https://example.test/manifest.json')

    expect(result.source).toBe('cache')
    expect(result.warning).toContain('캐시')
    expect(offlineFetch).toHaveBeenCalledTimes(2)
  })

  it('does not retry the same speculative URL after child validation fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => rootManifest })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...callGuideManifest, songs: null }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchCallGuideManifest('https://example.test/manifest.json')).rejects.toThrow()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads event index, month shard, and event detail through relative paths', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => rootManifest })
      .mockResolvedValueOnce({ ok: true, json: async () => eventIndex })
      .mockResolvedValueOnce({ ok: true, json: async () => month })
      .mockResolvedValueOnce({ ok: true, json: async () => eventDetail })
    vi.stubGlobal(
      'fetch',
      fetchMock,
    )

    const indexResult = await fetchEventCalendarIndex('https://example.test/manifest.json')
    const monthResult = await fetchEventCalendarMonth(indexResult.url, '2026-06', { expectedDataVersion: 'test' })
    const detailResult = await fetchEventDetail(monthResult.url, month.events[0].path, 'sample-event', {
      expectedDataVersion: 'test',
    })

    expect(indexResult.url).toBe('https://example.test/event-calendar/index.json')
    expect(indexResult.data.typePriority).toEqual(['concert', 'popup'])
    expect(monthResult.url).toBe('https://example.test/event-calendar/months/2026-06.json')
    expect(detailResult.url).toBe(
      'https://example.test/event-calendar/events/sample-event.json?_miku_data_version=test',
    )
    expect(detailResult.data.links.sns?.[0].url).toContain('x.com')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/manifest.json',
      'https://example.test/event-calendar/index.json',
      'https://example.test/event-calendar/months/2026-06.json',
      'https://example.test/event-calendar/events/sample-event.json?_miku_data_version=test',
    ])
  })

  it.each([
    ['a different', { ...eventDetail, dataVersion: 'other' }],
    ['a missing', withoutDataVersion(eventDetail)],
  ])('rejects network event detail with %s dataVersion without caching it', async (_label, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }))

    await expect(fetchEventDetail(
      'https://example.test/event-calendar/months/2026-06.json',
      '../events/sample-event.json',
      'sample-event',
      { expectedDataVersion: 'test' },
    )).rejects.toThrow(/dataVersion|required property/i)
    expect(window.localStorage.length).toBe(0)
  })

  it('rejects an invalid nested event calendar month instead of caching it', async () => {
    const invalidMonth = {
      ...month,
      events: [{
        ...month.events[0],
        occurrences: [{ id: 'day-1', startsOn: '2026-06-15' }],
      }],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => invalidMonth }),
    )

    await expect(fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
    })).rejects.toThrow()
    expect(window.localStorage.length).toBe(0)
  })

  it('rejects an invalid nested root manifest instead of following child paths', async () => {
    const invalidRoot = {
      ...rootManifest,
      dataVersion: '',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => invalidRoot }),
    )

    await expect(fetchCallGuideManifest('https://example.test/manifest.json')).rejects.toThrow()
    expect(window.localStorage.length).toBe(0)
  })

  it('aborts the unused speculative child when the root request fails', async () => {
    let childSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => {
      if (url === 'https://example.test/manifest.json') {
        return Promise.reject(new Error('root offline'))
      }
      childSignal = options.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        childSignal?.addEventListener('abort', () => reject(childSignal?.reason), { once: true })
      })
    }))

    await expect(fetchCallGuideManifest('https://example.test/manifest.json')).rejects.toThrow('root offline')

    expect(childSignal).toBeDefined()
    expect(childSignal?.aborted).toBe(true)
  })

  it('rejects wrong requested month and dataVersion payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...month, month: '2026-07' }),
    }))
    await expect(fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
    })).rejects.toThrow(/requested 2026-06/)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...month, dataVersion: 'other' }),
    }))
    await expect(fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
    })).rejects.toThrow(/dataVersion/)
  })

  it('uses only the expected-version month cache while offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => month }))
    await fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const fallback = await fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
    })
    expect(fallback.source).toBe('cache')
    await expect(fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'next',
    })).rejects.toThrow('offline')
  })

  it('uses a valid same-version event detail cache while offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => eventDetail }))
    await fetchEventDetail(
      'https://example.test/event-calendar/months/2026-06.json',
      '../events/sample-event.json',
      'sample-event',
      { expectedDataVersion: 'test' },
    )

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchEventDetail(
      'https://example.test/event-calendar/months/2026-06.json',
      '../events/sample-event.json',
      'sample-event',
      { expectedDataVersion: 'test' },
    )).resolves.toMatchObject({ source: 'cache', data: eventDetail })
  })

  it.each([
    ['different', { ...eventDetail, dataVersion: 'other' }],
    ['missing', withoutDataVersion(eventDetail)],
  ])('removes a same-key cached event detail with %s dataVersion', async (_label, cachedEvent) => {
    const manifestUrl = 'https://example.test/event-calendar/months/2026-06.json'
    const resourcePath = '../events/sample-event.json'
    const key = resourceCacheKey(manifestUrl, 'test', resourcePath)
    window.localStorage.setItem(cacheStorageKey(key), JSON.stringify({
      savedAt: new Date().toISOString(),
      value: cachedEvent,
    }))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await expect(fetchEventDetail(
      manifestUrl,
      resourcePath,
      'sample-event',
      { expectedDataVersion: 'test' },
    )).rejects.toThrow('offline')
    expect(window.localStorage.getItem(cacheStorageKey(key))).toBeNull()
  })

  it('preserves existing event leaf query parameters and pathname', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => eventDetail })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchEventDetail(
      'https://example.test/event-calendar/months/2026-06.json?origin=primary',
      '../events/sample-event.json?lang=ko#details',
      'sample-event',
      { expectedDataVersion: 'test' },
    )

    const requestedUrl = new URL(fetchMock.mock.calls[0][0])
    expect(requestedUrl.pathname).toBe('/event-calendar/events/sample-event.json')
    expect(requestedUrl.searchParams.get('lang')).toBe('ko')
    expect(requestedUrl.searchParams.get('_miku_data_version')).toBe('test')
    expect(requestedUrl.hash).toBe('#details')
    expect(result.url).toBe(requestedUrl.toString())
  })

  it('forwards AbortSignal and never falls back to cache for AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => month }))
    await fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
    })

    const controller = new AbortController()
    const abortError = new DOMException('aborted', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(abortError)
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
      signal: controller.signal,
    })).rejects.toBe(abortError)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/event-calendar/months/2026-06.json',
      expect.objectContaining({ signal: controller.signal }),
    )

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    const ignoredAbortFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => month })
    vi.stubGlobal('fetch', ignoredAbortFetch)
    await expect(fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
      signal: alreadyAborted.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(ignoredAbortFetch).not.toHaveBeenCalled()
  })

  it('does not let localStorage write failure break a valid network month', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => month }))

    await expect(fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
      expectedDataVersion: 'test',
    })).resolves.toMatchObject({ source: 'network', data: month })
  })

  it('does not dedupe requests carrying distinct AbortSignals', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => month })
    vi.stubGlobal('fetch', fetchMock)
    const first = new AbortController()
    const second = new AbortController()

    await Promise.all([
      fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
        expectedDataVersion: 'test',
        signal: first.signal,
      }),
      fetchEventCalendarMonth('https://example.test/event-calendar/index.json', '2026-06', {
        expectedDataVersion: 'test',
        signal: second.signal,
      }),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([, options]) => options.signal)).toEqual([first.signal, second.signal])
  })

  it('rejects an event detail whose id does not match the requested event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...eventDetail, id: 'other-event' }),
    }))

    await expect(fetchEventDetail(
      'https://example.test/event-calendar/months/2026-06.json',
      '../events/sample-event.json',
      'sample-event',
      { expectedDataVersion: 'test' },
    )).rejects.toThrow(/id.*sample-event/i)
    expect(window.localStorage.length).toBe(0)
  })
})
