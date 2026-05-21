import { localizedText } from '../callGuide/callPositioning'
import type { CalendarEventSummary, EventOccurrence, EventType } from '../data/types'

export interface CalendarBarSegment {
  event: CalendarEventSummary
  occurrence: EventOccurrence
  dateKeys: string[]
  dateKeyStart: string
  dateKeyEnd: string
  rowIndex: number
  columnStart: number
  columnEnd: number
  lane: number
  continuesBefore: boolean
  continuesAfter: boolean
}

function localDatePart(value: string): string {
  return value.slice(0, 10)
}

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number)
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number)
  const current = Date.UTC(startYear, startMonth - 1, startDay)
  const end = Date.UTC(endYear, endMonth - 1, endDay)

  for (let cursor = current; cursor <= end; cursor += 24 * 60 * 60 * 1000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10))
  }

  return dates
}

export function occurrenceDateKeys(occurrence: EventOccurrence): string[] {
  const startDate = occurrence.startsOn ?? localDatePart(occurrence.startsAt!)
  const endDate = occurrence.endsOn ?? (occurrence.endsAt ? localDatePart(occurrence.endsAt) : startDate)
  return datesBetween(startDate, endDate)
}

function firstOccurrenceStart(event: Pick<CalendarEventSummary, 'occurrences'>): string {
  return event.occurrences[0]?.startsAt ?? event.occurrences[0]?.startsOn ?? ''
}

function eventTitleSortKey(event: Pick<CalendarEventSummary, 'id' | 'title'>): string {
  return localizedText(event.title, 'ko', ['ja', 'en']) || event.id
}

export function compareCalendarEvents(typePriority: EventType[], eventA: CalendarEventSummary, eventB: CalendarEventSummary): number {
  const priorityA = typePriority.indexOf(eventA.type)
  const priorityB = typePriority.indexOf(eventB.type)
  const normalizedPriorityA = priorityA === -1 ? typePriority.length : priorityA
  const normalizedPriorityB = priorityB === -1 ? typePriority.length : priorityB

  return (
    normalizedPriorityA - normalizedPriorityB ||
    firstOccurrenceStart(eventA).localeCompare(firstOccurrenceStart(eventB)) ||
    eventTitleSortKey(eventA).localeCompare(eventTitleSortKey(eventB)) ||
    eventA.id.localeCompare(eventB.id)
  )
}

function addEventToDateMap(map: Map<string, CalendarEventSummary[]>, dateKey: string, event: CalendarEventSummary): void {
  const events = map.get(dateKey) ?? []
  if (!events.some((item) => item.id === event.id)) {
    events.push(event)
  }
  map.set(dateKey, events)
}

export function buildEventsByDate(events: CalendarEventSummary[]): Map<string, CalendarEventSummary[]> {
  const map = new Map<string, CalendarEventSummary[]>()

  for (const event of events) {
    for (const occurrence of event.occurrences) {
      for (const dateKey of occurrenceDateKeys(occurrence)) {
        addEventToDateMap(map, dateKey, event)
      }
    }
  }

  return map
}

function assignCalendarBarLanes(
  segments: Array<Omit<CalendarBarSegment, 'lane'>>,
  typePriority: EventType[],
): CalendarBarSegment[] {
  const byWeek = new Map<number, Array<Omit<CalendarBarSegment, 'lane'>>>()

  for (const segment of segments) {
    const weekSegments = byWeek.get(segment.rowIndex) ?? []
    weekSegments.push(segment)
    byWeek.set(segment.rowIndex, weekSegments)
  }

  return Array.from(byWeek.values()).flatMap((weekSegments) => {
    const lanes: CalendarBarSegment[][] = []

    return weekSegments
      .sort(
        (a, b) =>
          a.columnStart - b.columnStart ||
          compareCalendarEvents(typePriority, a.event, b.event) ||
          b.columnEnd - b.columnStart - (a.columnEnd - a.columnStart) ||
          a.columnEnd - b.columnEnd ||
          a.occurrence.id.localeCompare(b.occurrence.id) ||
          a.event.id.localeCompare(b.event.id),
      )
      .map((segment) => {
        let lane = lanes.findIndex((laneSegments) =>
          laneSegments.every((item) => item.columnEnd <= segment.columnStart || segment.columnEnd <= item.columnStart),
        )

        if (lane === -1) {
          lane = lanes.length
          lanes.push([])
        }

        const segmentWithLane = { ...segment, lane }
        lanes[lane].push(segmentWithLane)
        return segmentWithLane
      })
  })
}

export function buildCalendarBarSegments(
  events: CalendarEventSummary[],
  weeks: string[][],
  typePriority: EventType[],
): CalendarBarSegment[] {
  const segments: Array<Omit<CalendarBarSegment, 'lane'>> = []

  events.forEach((event) => {
    event.occurrences.forEach((occurrence) => {
      const dateKeys = occurrenceDateKeys(occurrence)

      weeks.forEach((week, rowIndex) => {
        const visibleDates = dateKeys.filter((dateKey) => week.includes(dateKey))
        if (visibleDates.length === 0) {
          return
        }

        const indexes = visibleDates.map((dateKey) => week.indexOf(dateKey))
        const firstIndex = Math.min(...indexes)
        const lastIndex = Math.max(...indexes)
        const dateKeyStart = week[firstIndex]
        const dateKeyEnd = week[lastIndex]

        segments.push({
          event,
          occurrence,
          dateKeys,
          dateKeyStart,
          dateKeyEnd,
          rowIndex,
          columnStart: firstIndex + 1,
          columnEnd: lastIndex + 2,
          continuesBefore: dateKeys[0] < dateKeyStart,
          continuesAfter: dateKeys[dateKeys.length - 1] > dateKeyEnd,
        })
      })
    })
  })

  return assignCalendarBarLanes(segments, typePriority)
}

export function groupBarsByWeek(segments: CalendarBarSegment[]): Map<number, CalendarBarSegment[]> {
  const map = new Map<number, CalendarBarSegment[]>()

  for (const segment of segments) {
    const weekSegments = map.get(segment.rowIndex) ?? []
    weekSegments.push(segment)
    map.set(segment.rowIndex, weekSegments)
  }

  return map
}
