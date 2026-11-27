import { ArrowRight, CalendarX2 } from 'lucide-react'
import { formatMonthLabel } from '../eventDate'

interface EventMonthEmptyStateProps {
  /** The month has events, but none match the selected type. */
  hasTypeFilter: boolean
  nearestMonth: string | null
  onClearFilter: () => void
  onGoToMonth: (month: string) => void
}

const emptyActionClassName =
  'event-month-empty-action flex min-h-touch-target items-center gap-1.5 rounded-[var(--radius-element)] border px-3 font-bold'

export function EventMonthEmptyState({
  hasTypeFilter,
  nearestMonth,
  onClearFilter,
  onGoToMonth,
}: EventMonthEmptyStateProps) {
  return (
    <div className="event-month-empty flex flex-wrap items-center gap-3 rounded-[var(--radius-element)] border px-3 py-1.5 text-sm text-[var(--color-text-secondary)]" role="status">
      <CalendarX2 aria-hidden="true" className="shrink-0" size={20} />
      <p className="m-0 flex-1">{hasTypeFilter ? '이 달에는 선택한 종류의 일정이 없어요.' : '이 달에는 등록된 일정이 없어요.'}</p>
      {hasTypeFilter ? (
        <button className={emptyActionClassName} onClick={onClearFilter} type="button">
          모든 종류 보기
        </button>
      ) : nearestMonth ? (
        <button className={emptyActionClassName} onClick={() => onGoToMonth(nearestMonth)} type="button">
          가장 가까운 일정: {formatMonthLabel(nearestMonth)}
          <ArrowRight aria-hidden="true" size={16} />
        </button>
      ) : null}
    </div>
  )
}
