import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchEventDetail = vi.hoisted(() => vi.fn())

vi.mock('../../data/fetchEventManifest', () => ({ fetchEventDetail }))

import { useEventDetails } from './useEventDetails'

afterEach(() => {
  fetchEventDetail.mockReset()
  vi.useRealTimers()
})

const event = {
  id: 'event-1',
  path: '../events/event-1.json',
  type: 'concert',
  title: { ko: '이벤트' },
  occurrences: [{ id: 'day-1', start: '2026-01-15' }],
}

const monthResult = {
  data: {
    dataVersion: 'v1',
    events: [event],
    generatedAt: '2026-01-01T00:00:00.000Z',
    month: '2026-01',
    schemaVersion: 1,
  },
  source: 'network',
  url: 'https://example.test/event-calendar/months/2026-01.json',
}

describe('useEventDetails', () => {
  it('limits concurrent event-detail requests to six', async () => {
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    fetchEventDetail.mockImplementation((_url, _path, id) => new Promise((resolve) => {
      active += 1
      peak = Math.max(peak, active)
      releases.push(() => {
        active -= 1
        resolve({ data: { id }, source: 'network', url: `https://example.test/events/${id}.json` })
      })
    }))
    const events = Array.from({ length: 14 }, (_, index) => ({
      ...event,
      id: `event-${index}`,
      path: `../events/event-${index}.json`,
    }))

    const { result } = renderHook(() => useEventDetails(monthResult as never, events as never))
    await waitFor(() => expect(fetchEventDetail).toHaveBeenCalledTimes(6))
    expect(peak).toBe(6)

    while (releases.length > 0 || fetchEventDetail.mock.calls.length < events.length) {
      const batch = releases.splice(0)
      await act(async () => batch.forEach((release) => release()))
      if (fetchEventDetail.mock.calls.length < events.length) {
        await waitFor(() => expect(releases.length).toBeGreaterThan(0))
      }
    }
    await waitFor(() => expect(Object.keys(result.current.details)).toHaveLength(events.length))
    expect(peak).toBe(6)
  })

  it('loads missing event details with the month version and exposes them by event id', async () => {
    fetchEventDetail.mockResolvedValue({
      data: { id: 'event-1', title: { ko: '이벤트' } },
      source: 'network',
      url: 'https://example.test/event-calendar/events/event-1.json',
    })

    const selectedEvents = [event] as never
    const { result } = renderHook(() => useEventDetails(monthResult as never, selectedEvents))

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.details['event-1']?.data.id).toBe('event-1'))
    expect(result.current.isLoading).toBe(false)
    expect(fetchEventDetail).toHaveBeenCalledWith(
      monthResult.url,
      event.path,
      event.id,
      expect.objectContaining({ expectedDataVersion: 'v1', signal: expect.any(AbortSignal) }),
    )
  })

  it('aborts an in-flight detail request on cleanup without surfacing an error', async () => {
    let rejectLoad: ((reason: unknown) => void) | undefined
    fetchEventDetail.mockImplementation((_url, _path, _id, options) => new Promise((_resolve, reject) => {
      rejectLoad = reject
      expect(options.signal.aborted).toBe(false)
    }))

    const { result, unmount } = renderHook(() => useEventDetails(monthResult as never, [event] as never))
    await waitFor(() => expect(fetchEventDetail).toHaveBeenCalledOnce())
    const signal = fetchEventDetail.mock.calls[0][3].signal as AbortSignal
    unmount()
    expect(signal.aborted).toBe(true)

    await act(async () => {
      rejectLoad?.(new DOMException('Aborted', 'AbortError'))
    })
    expect(result.current.error).toBeNull()
  })

  it('aborts the complete detail batch at the fifteen-second deadline', async () => {
    vi.useFakeTimers()
    fetchEventDetail.mockImplementation((_url, _path, _id, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))

    const selectedEvents = [event] as never
    const { result } = renderHook(() => useEventDetails(monthResult as never, selectedEvents))
    expect(fetchEventDetail).toHaveBeenCalledOnce()
    const signal = fetchEventDetail.mock.calls[0][3].signal as AbortSignal

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      await Promise.resolve()
      await Promise.resolve()
    })
    vi.useRealTimers()

    expect(signal.aborted).toBe(true)
    expect(signal.reason).toMatchObject({ code: 'DATA_REQUEST_TIMEOUT', timeoutMs: 15_000 })
    await waitFor(() => expect(result.current.error).toContain('timed out after 15 seconds'))
  })

  it('aborts sibling requests when one event detail fails', async () => {
    const signals: AbortSignal[] = []
    fetchEventDetail.mockImplementation((_url, _path, id, options) => {
      signals.push(options.signal)
      if (id === 'event-0') return Promise.reject(new Error('detail failed'))
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    const events = Array.from({ length: 7 }, (_, index) => ({
      ...event,
      id: `event-${index}`,
      path: `../events/event-${index}.json`,
    }))

    const { result } = renderHook(() => useEventDetails(monthResult as never, events as never))
    await waitFor(() => expect(result.current.error).toBe('detail failed'))

    expect(fetchEventDetail).toHaveBeenCalledTimes(6)
    expect(signals).toHaveLength(6)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })

  it('does not expose a cached detail after the month manifest origin changes', async () => {
    let resolveReplacement: ((value: unknown) => void) | undefined
    fetchEventDetail
      .mockResolvedValueOnce({
        data: { id: 'event-1', title: { ko: '기존 이벤트' } },
        source: 'network',
        url: 'https://canonical.example/events/event-1.json',
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveReplacement = resolve
      }))
    const selectedEvents = [event] as never

    const { result, rerender } = renderHook(
      ({ month, events }) => useEventDetails(month, events),
      { initialProps: { month: monthResult as never, events: selectedEvents } },
    )
    await waitFor(() => expect(result.current.details['event-1']?.data.title.ko).toBe('기존 이벤트'))

    const mirrorMonth = {
      ...monthResult,
      url: 'https://mirror.example/event-calendar/months/2026-01.json',
    }
    rerender({ month: mirrorMonth as never, events: selectedEvents })

    expect(result.current.details['event-1']).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(fetchEventDetail).toHaveBeenCalledTimes(2))
    expect(fetchEventDetail).toHaveBeenNthCalledWith(
      2,
      mirrorMonth.url,
      event.path,
      event.id,
      expect.objectContaining({ expectedDataVersion: 'v1', signal: expect.any(AbortSignal) }),
    )

    await act(async () => {
      resolveReplacement?.({
        data: { id: 'event-1', title: { ko: '미러 이벤트' } },
        source: 'network',
        url: 'https://mirror.example/events/event-1.json',
      })
    })
    await waitFor(() => expect(result.current.details['event-1']?.data.title.ko).toBe('미러 이벤트'))
  })

  it('does not expose a cached detail after the event resource path changes', async () => {
    let resolveReplacement: ((value: unknown) => void) | undefined
    fetchEventDetail
      .mockResolvedValueOnce({
        data: { id: 'event-1', title: { ko: '기존 이벤트' } },
        source: 'network',
        url: 'https://example.test/event-calendar/events/event-1.json',
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveReplacement = resolve
      }))

    const { result, rerender } = renderHook(
      ({ month, events }) => useEventDetails(month, events),
      { initialProps: { month: monthResult as never, events: [event] as never } },
    )
    await waitFor(() => expect(result.current.details['event-1']?.data.title.ko).toBe('기존 이벤트'))

    const movedEvent = { ...event, path: '../event-details/event-1.json' }
    rerender({ month: monthResult as never, events: [movedEvent] as never })

    expect(result.current.details['event-1']).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(fetchEventDetail).toHaveBeenCalledTimes(2))
    expect(fetchEventDetail).toHaveBeenNthCalledWith(
      2,
      monthResult.url,
      movedEvent.path,
      movedEvent.id,
      expect.objectContaining({ expectedDataVersion: 'v1', signal: expect.any(AbortSignal) }),
    )

    await act(async () => {
      resolveReplacement?.({
        data: { id: 'event-1', title: { ko: '이동된 이벤트' } },
        source: 'network',
        url: 'https://example.test/event-calendar/event-details/event-1.json',
      })
    })
    await waitFor(() => expect(result.current.details['event-1']?.data.title.ko).toBe('이동된 이벤트'))
  })

  it('reuses a detail for equivalent normalized month and resource URLs', async () => {
    fetchEventDetail.mockResolvedValue({
      data: { id: 'event-1', title: { ko: '이벤트' } },
      source: 'network',
      url: 'https://example.test/event-calendar/events/event-1.json?a=1&b=2',
    })
    const firstMonth = {
      ...monthResult,
      url: 'https://EXAMPLE.test/event-calendar/months/2026-01.json?b=2&a=1#first',
    }
    const firstEvent = { ...event, path: '../events/event-1.json?b=2&a=1#first' }
    const { result, rerender } = renderHook(
      ({ month, events }) => useEventDetails(month, events),
      { initialProps: { month: firstMonth as never, events: [firstEvent] as never } },
    )
    await waitFor(() => expect(result.current.details['event-1']?.data.id).toBe('event-1'))

    const equivalentMonth = {
      ...monthResult,
      url: 'https://example.test/event-calendar/months/2026-01.json?a=1&b=2#second',
    }
    const equivalentEvent = { ...event, path: '../events/event-1.json?a=1&b=2#second' }
    rerender({ month: equivalentMonth as never, events: [equivalentEvent] as never })

    expect(result.current.details['event-1']?.data.id).toBe('event-1')
    expect(fetchEventDetail).toHaveBeenCalledOnce()
  })
})
