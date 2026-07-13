import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fetchEventCalendarMonth = vi.hoisted(() => vi.fn())

vi.mock('../../data/fetchManifest', () => ({ fetchEventCalendarMonth }))

import { useEventMonth } from './useEventMonth'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fetchEventCalendarMonth.mockReset()
})

describe('useEventMonth', () => {
  it('uses the central loader with version and aborts its signal on cleanup', async () => {
    let resolveLoad: ((value: unknown) => void) | undefined
    fetchEventCalendarMonth.mockImplementation(() => new Promise((resolve) => {
      resolveLoad = resolve
    }))
    const directFetch = vi.fn()
    vi.stubGlobal('fetch', directFetch)
    const onReset = vi.fn()
    const calendarIndex = {
      url: 'https://example.test/event-calendar/index.json',
      data: { availableMonths: ['2026-06'], dataVersion: 'v1' },
    }

    const { unmount } = renderHook(() => useEventMonth(calendarIndex, '2026-06', onReset))
    await waitFor(() => expect(fetchEventCalendarMonth).toHaveBeenCalledOnce())
    const options = fetchEventCalendarMonth.mock.calls[0][2]
    expect(options.expectedDataVersion).toBe('v1')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(directFetch).not.toHaveBeenCalled()

    unmount()
    expect(options.signal.aborted).toBe(true)
    await act(async () => {
      resolveLoad?.({
        data: { schemaVersion: 1, generatedAt: '2026-07-01T00:00:00.000Z', dataVersion: 'v1', month: '2026-06', events: [] },
        source: 'network',
        url: 'https://example.test/event-calendar/months/2026-06.json',
      })
    })
  })

  it('hides the previous month result while a new identity is loading', async () => {
    let resolveNextLoad: ((value: unknown) => void) | undefined
    fetchEventCalendarMonth
      .mockResolvedValueOnce({
        data: {
          schemaVersion: 1,
          generatedAt: '2026-07-01T00:00:00.000Z',
          dataVersion: 'v1',
          month: '2026-06',
          events: [],
        },
        source: 'network',
        url: 'https://example.test/event-calendar/months/2026-06.json',
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveNextLoad = resolve
      }))

    const onReset = vi.fn()
    const indexUrl = 'https://example.test/event-calendar/index.json'
    const initialIndex = {
      url: indexUrl,
      data: { availableMonths: ['2026-06'], dataVersion: 'v1' },
    }
    const nextIndex = {
      url: indexUrl,
      data: { availableMonths: ['2026-06'], dataVersion: 'v2' },
    }

    const { result, rerender } = renderHook(
      ({ calendarIndex }) => useEventMonth(calendarIndex, '2026-06', onReset),
      { initialProps: { calendarIndex: initialIndex } },
    )

    await waitFor(() => expect(result.current.data?.data.dataVersion).toBe('v1'))

    rerender({ calendarIndex: nextIndex })

    expect(result.current.data).toBeNull()
    await waitFor(() => expect(fetchEventCalendarMonth).toHaveBeenCalledTimes(2))

    await act(async () => {
      resolveNextLoad?.({
        data: {
          schemaVersion: 1,
          generatedAt: '2026-07-02T00:00:00.000Z',
          dataVersion: 'v2',
          month: '2026-06',
          events: [],
        },
        source: 'network',
        url: 'https://example.test/event-calendar/months/2026-06.json',
      })
    })

    await waitFor(() => expect(result.current.data?.data.dataVersion).toBe('v2'))
  })
})
