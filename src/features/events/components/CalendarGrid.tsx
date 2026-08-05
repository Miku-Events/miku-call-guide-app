import { type CSSProperties, useEffect, useState } from 'react'
import { localizedText } from '../../../shared/i18n/localizedText'
import { dayKindFromDateKey, formatDateLabel } from '../eventDate'
import type { CalendarBarSegment } from '../calendarLayout'

function useCompactCalendar(): boolean {
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 620px)')
    const updateMatch = () => setIsCompact(mediaQuery.matches)
    updateMatch()
    mediaQuery.addEventListener('change', updateMatch)
    return () => mediaQuery.removeEventListener('change', updateMatch)
  }, [])

  return isCompact
}

interface CalendarGridProps {
  weeks: string[][]
  visibleMonth: string
  selectedDate: string | null
  todayKey: string
  openDateDetail: (dateKey: string) => void
  barsByWeek: Map<number, CalendarBarSegment[]>
}

export function CalendarGrid({
  weeks,
  visibleMonth,
  selectedDate,
  todayKey,
  openDateDetail,
  barsByWeek,
}: CalendarGridProps) {
  const isCompact = useCompactCalendar()

  return (
    <>
      <div className="event-weekdays" aria-hidden="true">
        {[
          ['Sun', 'sunday'],
          ['Mon', 'weekday'],
          ['Tue', 'weekday'],
          ['Wed', 'weekday'],
          ['Thu', 'weekday'],
          ['Fri', 'weekday'],
          ['Sat', 'saturday'],
        ].map(([day, dayKind]) => (
          <span data-day-kind={dayKind} key={day}>
            {day}
          </span>
        ))}
      </div>
      <div className="event-calendar-grid">
        {weeks.map((week, rowIndex) => {
          const weekBars = barsByWeek.get(rowIndex) ?? []
          const barLaneCount = weekBars.reduce((maxLane, segment) => Math.max(maxLane, segment.lane + 1), 0)
          const weekStyle = {
            '--event-week-bar-lanes': barLaneCount,
          } as CSSProperties

          return (
            <div className="event-week-row" data-has-bars={weekBars.length > 0} key={week[0]} style={weekStyle}>
              {week.map((dateKey) => {
                const inMonth = dateKey.startsWith(visibleMonth)
                const dayKind = dayKindFromDateKey(dateKey)
                const isSelected = selectedDate === dateKey
                const isToday = todayKey === dateKey
                const stateLabel = [isToday ? '오늘' : null, isSelected ? '선택됨' : null]
                  .filter(Boolean)
                  .join(', ')
                const dateLabel = `${formatDateLabel(dateKey)}${stateLabel ? `, ${stateLabel}` : ''}`
                return (
                  <button
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={dateLabel}
                    aria-pressed={isSelected}
                    className="event-day-cell"
                    data-date={dateKey}
                    data-day-kind={dayKind}
                    data-in-month={inMonth}
                    data-selected={isSelected}
                    data-today={isToday}
                    key={dateKey}
                    onClick={() => openDateDetail(dateKey)}
                    type="button"
                  >
                    <span className="event-day-number">{Number(dateKey.slice(-2))}</span>
                  </button>
                )
              })}
              {weekBars.length > 0 ? (
                <div className="event-span-bars" aria-hidden={isCompact || undefined} aria-label="Calendar events">
                  {weekBars.map((segment) => {
                    const title = localizedText(segment.event.title, 'ko', ['ja', 'en'])
                    const barStyle = {
                      gridColumn: `${segment.columnStart} / ${segment.columnEnd}`,
                      '--event-bar-lane': segment.lane,
                    } as CSSProperties

                    const commonProps = {
                      className: 'event-span-bar',
                      'data-continues-after': segment.continuesAfter,
                      'data-continues-before': segment.continuesBefore,
                      'data-event-id': segment.event.id,
                      'data-event-type': segment.event.type,
                      'data-occurrence-id': segment.occurrence.id,
                      'data-selected': selectedDate ? segment.dateKeys.includes(selectedDate) : false,
                      style: barStyle,
                    }

                    return isCompact ? (
                      <div
                        {...commonProps}
                        aria-hidden="true"
                        key={`${segment.event.id}-${segment.occurrence.id}-${segment.rowIndex}`}
                      >
                        <span>{title}</span>
                      </div>
                    ) : (
                      <button
                        {...commonProps}
                        aria-label={`${title}: ${formatDateLabel(segment.dateKeyStart)} - ${formatDateLabel(segment.dateKeyEnd)}`}
                        key={`${segment.event.id}-${segment.occurrence.id}-${segment.rowIndex}`}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation()
                          openDateDetail(segment.dateKeyStart)
                        }}
                        type="button"
                      >
                        <span>{title}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
