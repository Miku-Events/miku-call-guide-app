import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEventSummary, EventCalendarMonth, LoadResult } from '../data/types'

type MonthResult = LoadResult<EventCalendarMonth> & { url: string }

const event: CalendarEventSummary = {
  id: 'sample-event',
  title: { ko: '샘플 이벤트' },
  type: 'concert',
  occurrences: [{
    id: 'main',
    startsOn: '2026-07-11',
    endsOn: '2026-07-11',
    timezone: 'Asia/Seoul',
  }],
  path: '../events/sample-event.json',
}

const harness = vi.hoisted(() => ({
  fetchEventCalendarIndex: vi.fn(),
  fetchEventDetail: vi.fn(),
  fetchSubmissionSession: vi.fn(),
  monthLoading: false,
  monthResult: null as MonthResult | null,
}))

vi.mock('../../app/config', () => ({
  getRootManifestUrl: () => 'https://example.test/manifest.json',
  getSubmissionApiBaseUrl: () => 'https://example.test',
}))

vi.mock('../../shared/layout/AppPageShell', () => ({
  AppPageShell: ({ children, toolbar }: { children: ReactNode; toolbar: ReactNode }) => (
    <><div>{toolbar}</div>{children}</>
  ),
  StatusBanner: ({ children, role }: { children: ReactNode; role?: string }) => (
    <div role={role}>{children}</div>
  ),
}))

vi.mock('../data/fetchManifest', () => ({
  fetchEventCalendarIndex: harness.fetchEventCalendarIndex,
  fetchEventDetail: harness.fetchEventDetail,
}))

vi.mock('./submissionClient', () => ({
  fetchSubmissionSession: harness.fetchSubmissionSession,
}))

vi.mock('./hooks/useEventMonth', () => ({
  useEventMonth: () => ({
    data: harness.monthResult,
    error: null,
    isLoading: harness.monthLoading,
  }),
}))

vi.mock('./hooks/useOverflowDragScroll', () => ({
  useOverflowDragScroll: () => ({
    canDrag: false,
    dragScrollProps: {},
    isDragging: false,
    ref: { current: null },
  }),
}))

vi.mock('./hooks/useSheetDismissHandle', () => ({
  useSheetDismissHandle: () => ({ dragY: 0, handleProps: {}, isDragging: false }),
}))

vi.mock('./components/CalendarGrid', () => ({
  CalendarGrid: ({ openDateDetail }: { openDateDetail: (dateKey: string) => void }) => (
    <button onClick={() => openDateDetail('2026-07-11')} type="button">날짜 선택</button>
  ),
}))

vi.mock('./components/EventDetailSheet', () => ({
  EventDetailSheet: ({ isLoading }: { isLoading: boolean }) => (
    <div aria-busy={isLoading} data-testid="event-detail-loading" />
  ),
}))

vi.mock('./components/EventSubmitDialog', () => ({
  EventSubmitDialog: ({ setSubmissionSuccess }: { setSubmissionSuccess: (message: string) => void }) => (
    <button onClick={() => setSubmissionSuccess('제보가 접수되었습니다.')} type="button">성공 알림</button>
  ),
}))

vi.mock('@astryxdesign/core/Button', () => ({
  Button: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button onClick={onClick} type="button">{label}</button>
  ),
}))

import { EventCalendarPage } from './EventCalendarPage'

function monthResult(): MonthResult {
  return {
    data: {
      schemaVersion: 1,
      generatedAt: '2026-07-01T00:00:00.000Z',
      dataVersion: 'v1',
      month: '2026-07',
      events: [event],
    },
    source: 'network',
    url: 'https://example.test/event-calendar/months/2026-07.json',
  }
}

beforeEach(() => {
  harness.monthLoading = false
  harness.monthResult = monthResult()
  harness.fetchEventCalendarIndex.mockResolvedValue({
    data: {
      schemaVersion: 1,
      generatedAt: '2026-07-01T00:00:00.000Z',
      dataVersion: 'v1',
      availableMonths: ['2026-07'],
      types: ['concert'],
      typePriority: ['concert'],
    },
    source: 'network',
    url: 'https://example.test/event-calendar/index.json',
  })
  harness.fetchSubmissionSession.mockResolvedValue({ authenticated: false })
  harness.fetchEventDetail.mockImplementation(() => new Promise(() => {}))
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('EventCalendarPage accessibility', () => {
  it('groups event filters and exposes their pressed state', async () => {
    render(<EventCalendarPage />)

    const filters = await screen.findByRole('group', { name: '이벤트 종류 필터' })
    const all = screen.getByRole('button', { name: 'All' })
    const concert = screen.getByRole('button', { name: 'Concert' })
    expect(filters).toContainElement(all)
    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(concert).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(concert)
    expect(concert).toHaveAttribute('aria-pressed', 'true')
    expect(all).toHaveAttribute('aria-pressed', 'false')
  })

  it('announces month loading and detail loading with busy state', async () => {
    harness.monthLoading = true
    render(<EventCalendarPage />)

    const calendar = screen.getByRole('region', { name: 'Monthly event calendar' })
    expect(calendar).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('달력 데이터를 불러오는 중')

    harness.monthLoading = false
    fireEvent.click(screen.getByRole('button', { name: '날짜 선택' }))
    await waitFor(() => {
      expect(screen.getByTestId('event-detail-loading')).toHaveAttribute('aria-busy', 'true')
    })
  })

  it('stays busy while the selected month has not produced a result yet', async () => {
    harness.monthResult = null
    harness.monthLoading = false
    render(<EventCalendarPage />)

    await screen.findByRole('group', { name: '이벤트 종류 필터' })
    expect(screen.getByRole('region', { name: 'Monthly event calendar' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByText(/달력 데이터를 불러오는 중/)).toHaveAttribute('role', 'status')
  })

  it('uses a page status region only for successful submission feedback', async () => {
    render(<EventCalendarPage />)
    fireEvent.click(screen.getByRole('button', { name: '성공 알림' }))

    expect(await screen.findByRole('status')).toHaveTextContent('제보가 접수되었습니다.')
  })
})
