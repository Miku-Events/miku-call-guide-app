import { describe, expect, it } from 'vitest'
import type { CalendarEventSummary, EventOccurrence, EventType } from '../data/types'
import { buildCalendarBarSegments } from './calendarLayout'

const week = [
  '2026-05-10',
  '2026-05-11',
  '2026-05-12',
  '2026-05-13',
  '2026-05-14',
  '2026-05-15',
  '2026-05-16',
]

const typePriority: EventType[] = ['popup', 'concert', 'ticketApplication', 'other']

function summary(id: string, type: EventType, occurrence: EventOccurrence): CalendarEventSummary {
  return {
    id,
    title: { ko: id },
    type,
    occurrences: [occurrence],
    path: `../events/${id}.json`,
  }
}

function occurrence(id: string, startsOn: string, endsOn = startsOn): EventOccurrence {
  return {
    id,
    startsOn,
    endsOn,
    timezone: 'Asia/Seoul',
  }
}

describe('buildCalendarBarSegments', () => {
  it('reuses a released middle lane for a later one-day event in the same week', () => {
    const segments = buildCalendarBarSegments(
      [
        summary('lane-base', 'concert', occurrence('base-period', '2026-05-10', '2026-05-16')),
        summary('lane-middle', 'popup', occurrence('middle-period', '2026-05-11', '2026-05-13')),
        summary('lane-upper', 'popup', occurrence('upper-period', '2026-05-12', '2026-05-16')),
        summary('lane-reuse', 'popup', occurrence('reuse-day', '2026-05-14')),
      ],
      [week],
      typePriority,
    )

    const laneByOccurrence = new Map(segments.map((segment) => [segment.occurrence.id, segment.lane]))

    expect(laneByOccurrence.get('base-period')).toBe(0)
    expect(laneByOccurrence.get('middle-period')).toBe(1)
    expect(laneByOccurrence.get('upper-period')).toBe(2)
    expect(laneByOccurrence.get('reuse-day')).toBe(1)
    expect(Math.max(...segments.map((segment) => segment.lane))).toBe(2)
  })
})
