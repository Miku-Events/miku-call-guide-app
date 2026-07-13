import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEventSummary, EventOccurrence } from '../../data/types'
import { CalendarGrid } from './CalendarGrid'

const occurrence: EventOccurrence = {
  id: 'main',
  startsOn: '2026-07-11',
  endsOn: '2026-07-11',
  timezone: 'Asia/Seoul',
}

const event: CalendarEventSummary = {
  id: 'sample-event',
  title: { ko: '샘플 이벤트' },
  type: 'concert',
  occurrences: [occurrence],
  path: '../events/sample-event.json',
}

const weeks = [[
  '2026-07-05',
  '2026-07-06',
  '2026-07-07',
  '2026-07-08',
  '2026-07-09',
  '2026-07-10',
  '2026-07-11',
]]

const barsByWeek = new Map([[0, [{
  event,
  occurrence,
  rowIndex: 0,
  lane: 0,
  columnStart: 7,
  columnEnd: 8,
  continuesBefore: false,
  continuesAfter: false,
  dateKeys: ['2026-07-11'],
  dateKeyStart: '2026-07-11',
  dateKeyEnd: '2026-07-11',
}]]])

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList)))
}

function renderCalendar(openDateDetail = vi.fn()) {
  render(
    <CalendarGrid
      barsByWeek={barsByWeek}
      calendarIsDragging={false}
      openDateDetail={openDateDetail}
      selectedDate="2026-07-11"
      todayKey="2026-07-11"
      visibleMonth="2026-07"
      weeks={weeks}
    />,
  )
  return openDateDetail
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CalendarGrid accessibility', () => {
  it('exposes each date with its full date, current date, and selected state', () => {
    stubMatchMedia(false)
    renderCalendar()

    const selectedDay = document.querySelector<HTMLElement>('[data-date="2026-07-11"]')
    expect(selectedDay).toHaveAccessibleName('2026년 7월 11일 토요일, 오늘, 선택됨')
    expect(selectedDay).toHaveAttribute('aria-current', 'date')
    expect(selectedDay).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps event bars non-interactive and leaves the date as the sole compact trigger', () => {
    stubMatchMedia(true)
    const openDateDetail = renderCalendar()

    const visualBar = document.querySelector<HTMLElement>('.event-span-bar')
    expect(visualBar).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button', { name: /샘플 이벤트/ })).not.toBeInTheDocument()

    fireEvent.click(visualBar!)
    expect(openDateDetail).not.toHaveBeenCalled()

    fireEvent.click(document.querySelector<HTMLElement>('[data-date="2026-07-11"]')!)
    expect(openDateDetail).toHaveBeenCalledOnce()
  })

  it('keeps event bars as labeled buttons on desktop', () => {
    stubMatchMedia(false)
    const openDateDetail = renderCalendar()

    fireEvent.click(screen.getByRole('button', { name: /샘 이벤트|샘플 이벤트/ }))
    expect(openDateDetail).toHaveBeenCalledWith('2026-07-11')
  })
})
