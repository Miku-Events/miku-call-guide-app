import { localizedText } from '../../../shared/i18n/localizedText'
import type { CalendarEventSummary } from '../../data/types'
import { occurrenceDateKeys } from '../calendarLayout'
import { eventTypePresentation } from '../eventTypes'

interface EventAgendaListProps {
  events: CalendarEventSummary[]
  visibleMonth: string
  selectedDate: string | null
  openDateDetail: (dateKey: string) => void
}

interface AgendaItem {
  key: string
  event: CalendarEventSummary
  firstDateKey: string
  lastDateKey: string
  openDateKey: string
}

const weekdayFormatter = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' })

function formatAgendaDate(dateKey: string): string {
  const [year, month, date] = dateKey.split('-').map(Number)
  const weekday = weekdayFormatter.format(new Date(year, month - 1, date))
  return `${month}.${date} (${weekday})`
}

function buildAgendaItems(events: CalendarEventSummary[], visibleMonth: string): AgendaItem[] {
  const items: AgendaItem[] = []

  for (const event of events) {
    for (const occurrence of event.occurrences) {
      const dateKeys = occurrenceDateKeys(occurrence)
      const inMonth = dateKeys.filter((dateKey) => dateKey.startsWith(visibleMonth))
      if (inMonth.length === 0) continue

      items.push({
        key: `${event.id}-${occurrence.id}`,
        event,
        firstDateKey: dateKeys[0],
        lastDateKey: dateKeys[dateKeys.length - 1],
        openDateKey: inMonth[0],
      })
    }
  }

  // Events arrive in type-priority order; a stable sort by date keeps that order within a day.
  return items.sort((itemA, itemB) => itemA.openDateKey.localeCompare(itemB.openDateKey))
}

/**
 * Readable month agenda for narrow screens, where calendar cells are too
 * small to carry event titles.
 */
export function EventAgendaList({ events, visibleMonth, selectedDate, openDateDetail }: EventAgendaListProps) {
  const items = buildAgendaItems(events, visibleMonth)
  if (items.length === 0) {
    // The page-level empty state explains an empty month and offers the way out.
    return null
  }

  return (
    <section aria-labelledby="event-agenda-heading" className="event-agenda">
      <h2 className="event-agenda-heading" id="event-agenda-heading">
        이달의 일정 <span>{items.length}</span>
      </h2>
      <ul className="event-agenda-list grid gap-2">
        {items.map((item) => {
          const title = localizedText(item.event.title, 'ko', ['ja', 'en'])
          const dateRange = item.firstDateKey === item.lastDateKey
            ? formatAgendaDate(item.firstDateKey)
            : `${formatAgendaDate(item.firstDateKey)} – ${formatAgendaDate(item.lastDateKey)}`

          return (
            <li key={item.key}>
              <button
                className="event-agenda-item flex w-full flex-wrap justify-between gap-2 rounded-[var(--radius-element)] border px-3 py-1.5 text-sm font-bold"
                data-event-type={item.event.type}
                data-selected={selectedDate === item.openDateKey}
                onClick={() => openDateDetail(item.openDateKey)}
                type="button"
              >
                <span className="event-agenda-date">{dateRange}</span>
                <span className="event-agenda-title">{title}</span>
                <span className="event-agenda-type">{eventTypePresentation[item.event.type].label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
