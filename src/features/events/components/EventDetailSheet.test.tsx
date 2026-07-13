import type { ComponentProps } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalendarEventSummary, EventGuide, LoadResult } from '../../data/types'
import { EventDetailSheet } from './EventDetailSheet'

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

const detail: LoadResult<EventGuide> = {
  data: {
    schemaVersion: 1,
    dataVersion: 'v1',
    id: event.id,
    status: 'published',
    title: event.title,
    type: event.type,
    occurrences: event.occurrences,
    links: { official: 'https://events.example.test/sample' },
  },
  source: 'network',
}

function props(overrides: Partial<ComponentProps<typeof EventDetailSheet>> = {}): ComponentProps<typeof EventDetailSheet> {
  return {
    selectedDate: '2026-07-11',
    selectedEvents: [event],
    eventDetails: {},
    isLoading: true,
    isDetailExpanded: true,
    detailExpanded: true,
    setDetailExpanded: vi.fn(),
    detailDismissDragY: 0,
    detailDismissHandleProps: {} as ComponentProps<typeof EventDetailSheet>['detailDismissHandleProps'],
    detailDismissDragging: false,
    detailCanDrag: false,
    detailIsDragging: false,
    detailDragScrollProps: {} as ComponentProps<typeof EventDetailSheet>['detailDragScrollProps'],
    detailRef: { current: null },
    setDialog: vi.fn(),
    ...overrides,
  }
}

afterEach(cleanup)

describe('EventDetailSheet loading semantics', () => {
  it('labels the sheet from its heading and keeps unloaded event titles non-interactive', () => {
    render(<EventDetailSheet {...props()} />)

    const sheet = screen.getByRole('complementary')
    const heading = screen.getByRole('heading', { name: '2026년 7월 11일 토요일' })
    expect(sheet).toHaveAttribute('aria-labelledby', heading.id)

    const list = document.querySelector<HTMLElement>('.event-detail-list')
    expect(list).toHaveAttribute('aria-busy', 'true')
    expect(within(list!).getByText(/상세 정보를 불러오는 중/)).toHaveAttribute('role', 'status')
    expect(screen.getByText('샘플 이벤트')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /샘플 이벤트/ })).not.toBeInTheDocument()
  })

  it('renders the event title as an external link only after detail data loads', () => {
    render(<EventDetailSheet {...props({ eventDetails: { [event.id]: detail }, isLoading: false })} />)

    expect(document.querySelector('.event-detail-list')).toHaveAttribute('aria-busy', 'false')
    expect(screen.queryByText(/상세 정보를 불러오는 중/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /샘플 이벤트/ })).toHaveAttribute(
      'href',
      'https://events.example.test/sample',
    )
  })
})
