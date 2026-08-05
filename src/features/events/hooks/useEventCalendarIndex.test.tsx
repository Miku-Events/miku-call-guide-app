import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchEventCalendarIndex = vi.hoisted(() => vi.fn())

vi.mock('../../data/fetchEventManifest', () => ({ fetchEventCalendarIndex }))

import { useEventCalendarIndex } from './useEventCalendarIndex'

const result = {
  data: {
    schemaVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    dataVersion: 'v1',
    availableMonths: ['2026-08'],
    types: ['concert'],
  },
  source: 'network',
  url: 'https://example.test/event-calendar/index.json',
}

beforeEach(() => fetchEventCalendarIndex.mockReset())

describe('useEventCalendarIndex', () => {
  it('uses the same abortable path for the initial load and retry', async () => {
    fetchEventCalendarIndex
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(result)
    const { result: hook } = renderHook(() => useEventCalendarIndex('https://example.test/manifest.json'))

    await waitFor(() => expect(hook.current.error).toBe('temporary failure'))
    act(() => hook.current.retry())
    await waitFor(() => expect(hook.current.data).toEqual(result))

    expect(fetchEventCalendarIndex).toHaveBeenCalledTimes(2)
    expect(fetchEventCalendarIndex.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal)
    expect(fetchEventCalendarIndex.mock.calls[1]?.[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('aborts a pending consumer on unmount', () => {
    fetchEventCalendarIndex.mockResolvedValue(result)
    const { unmount } = renderHook(() => useEventCalendarIndex('https://example.test/manifest.json'))
    const signal = fetchEventCalendarIndex.mock.calls[0]?.[1].signal as AbortSignal

    unmount()

    expect(signal.aborted).toBe(true)
  })
})
