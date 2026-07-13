import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEventCalendarController } from './useEventCalendarController'

describe('useEventCalendarController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 15, 12))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('owns month navigation and resets the selected day', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const { result } = renderHook(() => useEventCalendarController())

    expect(result.current.visibleMonth).toBe('2026-01')
    act(() => result.current.openDateDetail('2026-01-15'))
    expect(result.current.selectedDate).toBe('2026-01-15')
    expect(result.current.detailExpanded).toBe(true)

    act(() => result.current.moveMonth(1))
    expect(result.current.visibleMonth).toBe('2026-02')
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.detailExpanded).toBe(false)
  })

  it('owns event filtering and explicit detail dismissal', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    const { result } = renderHook(() => useEventCalendarController())

    act(() => result.current.setTypeFilter('concert'))
    expect(result.current.typeFilter).toBe('concert')

    act(() => result.current.openDateDetail('2026-01-20'))
    expect(result.current.detailExpanded).toBe(false)
    act(() => result.current.setDetailExpanded(true))
    act(() => result.current.closeEventDetail())
    expect(result.current.selectedDate).toBeNull()
    expect(result.current.detailExpanded).toBe(false)
  })
})
