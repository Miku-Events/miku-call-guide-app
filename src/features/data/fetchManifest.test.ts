import { afterEach, describe, expect, it, vi } from 'vitest'
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
  id: 'sample-event',
  status: 'published',
  title: { ko: '샘플 이벤트' },
  type: 'concert',
  occurrences: month.events[0].occurrences,
  links: { sns: [{ platform: 'x', url: 'https://x.com/example/status/123' }] },
}

describe('fetch manifest helpers', () => {
  afterEach(() => {
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
    expect(window.localStorage.length).toBe(2)
  })

  it('falls back to the last successful call-guide manifest cache when the child manifest fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => rootManifest })
        .mockResolvedValueOnce({ ok: true, json: async () => callGuideManifest })
        .mockResolvedValueOnce({ ok: true, json: async () => rootManifest })
        .mockRejectedValueOnce(new Error('offline')),
    )

    await fetchCallGuideManifest('https://example.test/manifest.json')
    const result = await fetchCallGuideManifest('https://example.test/manifest.json')

    expect(result.source).toBe('cache')
    expect(result.warning).toContain('캐시')
  })

  it('loads event index, month shard, and event detail through relative paths', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => rootManifest })
        .mockResolvedValueOnce({ ok: true, json: async () => eventIndex })
        .mockResolvedValueOnce({ ok: true, json: async () => month })
        .mockResolvedValueOnce({ ok: true, json: async () => eventDetail }),
    )

    const indexResult = await fetchEventCalendarIndex('https://example.test/manifest.json')
    const monthResult = await fetchEventCalendarMonth(indexResult.url, '2026-06')
    const detailResult = await fetchEventDetail(monthResult.url, month.events[0].path, 'sample-event')

    expect(indexResult.url).toBe('https://example.test/event-calendar/index.json')
    expect(indexResult.data.typePriority).toEqual(['concert', 'popup'])
    expect(monthResult.url).toBe('https://example.test/event-calendar/months/2026-06.json')
    expect(detailResult.url).toBe('https://example.test/event-calendar/events/sample-event.json')
    expect(detailResult.data.links.sns?.[0].url).toContain('x.com')
  })
})
