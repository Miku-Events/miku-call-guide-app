import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CalendarEventSummary,
  EventCalendarMonth,
  EventGuide,
  LoadResult,
} from '../data/types'

type MonthResult = LoadResult<EventCalendarMonth> & { url: string }

const harness = vi.hoisted(() => ({
  fetchEventCalendarIndex: vi.fn(),
  fetchEventDetail: vi.fn(),
  fetchSubmissionSession: vi.fn(),
  monthResult: null as MonthResult | null,
}))

vi.mock('../../app/config', () => ({
  getRootManifestUrl: () => 'https://example.test/manifest.json',
  getSubmissionApiBaseUrl: () => 'https://example.test',
}))

vi.mock('../../shared/layout/AppPageShell', () => ({
  AppPageShell: ({ children }: { children: ReactNode }) => <>{children}</>,
  StatusBanner: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../data/fetchManifest', () => ({
  fetchEventCalendarIndex: harness.fetchEventCalendarIndex,
  fetchEventDetail: harness.fetchEventDetail,
}))

vi.mock('./submissionClient', () => ({
  fetchSubmissionSession: harness.fetchSubmissionSession,
}))

vi.mock('./hooks/useEventMonth', () => ({
  useEventMonth: () => ({ data: harness.monthResult, error: null, isLoading: false }),
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
  useSheetDismissHandle: () => ({
    dragY: 0,
    handleProps: {},
    isDragging: false,
  }),
}))

vi.mock('./components/CalendarGrid', () => ({
  CalendarGrid: ({ openDateDetail }: { openDateDetail: (date: string) => void }) => (
    <button onClick={() => openDateDetail('2026-06-15')} type="button">
      Select event
    </button>
  ),
}))

vi.mock('./components/EventDetailSheet', () => ({
  EventDetailSheet: ({ eventDetails }: { eventDetails: Record<string, LoadResult<EventGuide>> }) => (
    <div>{eventDetails['same-event']?.data.title.ko}</div>
  ),
}))

vi.mock('./components/EventSubmitDialog', () => ({
  EventSubmitDialog: () => null,
}))

vi.mock('@astryxdesign/core/Button', () => ({
  Button: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button onClick={onClick} type="button">{label}</button>
  ),
}))

import { EventCalendarPage } from './EventCalendarPage'

const event: CalendarEventSummary = {
  id: 'same-event',
  title: { ko: 'Same event' },
  type: 'concert',
  occurrences: [{
    id: 'occurrence-1',
    startsOn: '2026-06-15',
    endsOn: '2026-06-15',
    timezone: 'Asia/Seoul',
  }],
  path: '../events/same-event.json',
}

function monthResult(dataVersion: string): MonthResult {
  return {
    data: {
      schemaVersion: 1,
      generatedAt: '2026-07-01T00:00:00.000Z',
      dataVersion,
      month: '2026-06',
      events: [{ ...event }],
    },
    source: 'network',
    url: 'https://example.test/event-calendar/months/2026-06.json',
  }
}

function detailResult(label: string, dataVersion: string): LoadResult<EventGuide> & { url: string } {
  return {
    data: {
      schemaVersion: 1,
      dataVersion,
      id: 'same-event',
      status: 'published',
      title: { ko: label },
      type: 'concert',
      occurrences: event.occurrences,
      links: {},
    },
    source: 'network',
    url: 'https://example.test/event-calendar/events/same-event.json',
  }
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  harness.monthResult = monthResult('v1')
  harness.fetchEventCalendarIndex.mockResolvedValue({
    data: {
      schemaVersion: 1,
      generatedAt: '2026-07-01T00:00:00.000Z',
      dataVersion: 'v1',
      availableMonths: ['2026-06'],
      types: ['concert'],
      typePriority: ['concert'],
    },
    source: 'network',
    url: 'https://example.test/event-calendar/index.json',
  })
  harness.fetchSubmissionSession.mockResolvedValue({ authenticated: false })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('EventCalendarPage detail versioning', () => {
  it('hides v1 detail and refetches the same event id when v2 becomes current', async () => {
    let resolveV2: ((result: LoadResult<EventGuide> & { url: string }) => void) | undefined
    harness.fetchEventDetail
      .mockResolvedValueOnce(detailResult('Detail v1', 'v1'))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveV2 = resolve
      }))

    const { rerender } = render(<EventCalendarPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Select event' }))
    expect(await screen.findByText('Detail v1')).toBeInTheDocument()

    harness.monthResult = monthResult('v2')
    rerender(<EventCalendarPage />)

    expect(screen.queryByText('Detail v1')).not.toBeInTheDocument()
    await waitFor(() => expect(harness.fetchEventDetail).toHaveBeenCalledTimes(2))
    expect(harness.fetchEventDetail.mock.calls[1][3].expectedDataVersion).toBe('v2')

    await act(async () => {
      resolveV2?.(detailResult('Detail v2', 'v2'))
    })

    expect(await screen.findByText('Detail v2')).toBeInTheDocument()
  })
})
