import { type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { CalendarDays, ExternalLink, Maximize2, Minimize2 } from 'lucide-react'
import { localizedText } from '../../../shared/i18n/localizedText'
import type { CalendarEventSummary, EventGuide, EventLink, EventOccurrence, LoadResult } from '../../data/types'
import { occurrenceDateKeys } from '../calendarLayout'
import { isEmbeddableXPost } from '../eventEmbeds'
import { XPostEmbed } from '../XPostEmbed'
import { Token } from '@astryxdesign/core/Token'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import type { SheetDismissHandleResult } from '../hooks/useSheetDismissHandle'
import type { OverflowDragScrollResult } from '../hooks/useOverflowDragScroll'

const eventTypeLabels: Record<string, string> = {
  concert: 'Concert',
  dj: 'DJ',
  popup: 'Popup',
  ticketApplication: 'Ticket apply',
  ticketGeneralSale: 'General sale',
  livestream: 'Livestream',
  exhibition: 'Exhibition',
  collaboration: 'Collab',
  announcement: 'Notice',
  other: 'Other',
}

const eventColorMap: Record<string, 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'cyan' | 'blue' | 'purple' | 'pink' | 'gray'> = {
  concert: 'pink',
  dj: 'purple',
  popup: 'orange',
  ticketApplication: 'blue',
  ticketGeneralSale: 'blue',
  livestream: 'cyan',
  exhibition: 'yellow',
  collaboration: 'teal',
  announcement: 'red',
  other: 'gray',
}

const eventPlatformLabels: Record<EventLink['platform'], string> = {
  x: 'X',
  instagram: 'Instagram',
  youtube: 'YouTube',
  niconico: 'Niconico',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  website: 'Website',
  other: 'Other',
}

type DialogState =
  | { kind: 'add' }
  | { kind: 'edit'; event: CalendarEventSummary; occurrence?: EventOccurrence }
  | null

function formatDateLabel(dateKey: string): string {
  const [year, month, date] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(new Date(year, month - 1, date))
}

function formatOccurrenceTime(occurrence: EventOccurrence): string | null {
  if (occurrence.startsAt === undefined) {
    return null
  }

  const formatter = new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: occurrence.timezone,
  })
  const start = formatter.format(new Date(occurrence.startsAt))
  const end = occurrence.endsAt ? formatter.format(new Date(occurrence.endsAt)) : null
  return end ? `${start} - ${end}` : start
}

interface EventDetailSheetProps {
  selectedDate: string | null
  selectedEvents: CalendarEventSummary[]
  eventDetails: Record<string, LoadResult<EventGuide>>
  isLoading: boolean
  isDetailExpanded: boolean
  detailExpanded: boolean
  setDetailExpanded: React.Dispatch<React.SetStateAction<boolean>>
  detailDismissDragY: number
  detailDismissHandleProps: SheetDismissHandleResult['handleProps']
  detailDismissDragging: boolean
  detailCanDrag: boolean
  detailIsDragging: boolean
  detailDragScrollProps: OverflowDragScrollResult<HTMLElement>['dragScrollProps']
  detailRef: React.RefObject<HTMLElement | null>
  setDialog: React.Dispatch<React.SetStateAction<DialogState>>
}

export function EventDetailSheet({
  selectedDate,
  selectedEvents,
  eventDetails,
  isLoading,
  isDetailExpanded,
  detailExpanded,
  setDetailExpanded,
  detailDismissDragY,
  detailDismissHandleProps,
  detailDismissDragging,
  detailCanDrag,
  detailIsDragging,
  detailDragScrollProps,
  detailRef,
  setDialog,
}: EventDetailSheetProps) {
  const handleDetailPanelClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!selectedDate || detailExpanded || window.matchMedia('(max-width: 980px)').matches) {
      return
    }

    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    if (target.closest('a, button, input, select, textarea, [data-sheet-dismiss-handle="true"]')) {
      return
    }

    setDetailExpanded(true)
  }

  return (
    <aside
      aria-labelledby="event-detail-heading"
      className="event-detail-panel"
      data-dismiss-dragging={detailDismissDragging}
      data-dragging={detailIsDragging}
      data-expanded={isDetailExpanded}
      data-open={Boolean(selectedDate)}
      data-scrollable={detailCanDrag}
      onClick={handleDetailPanelClick}
      ref={detailRef}
      style={{ '--event-detail-drag-y': `${detailDismissDragY}px` } as CSSProperties}
      {...detailDragScrollProps}
    >
      <button
        className="event-detail-dismiss-handle"
        aria-label="상세 닫기"
        data-dragging={detailDismissDragging}
        data-sheet-dismiss-handle="true"
        type="button"
        {...detailDismissHandleProps}
      >
        <span aria-hidden="true" />
      </button>
      <div className="event-detail-heading">
        <div>
          <p>Selected day</p>
          <h2 id="event-detail-heading">{selectedDate ? formatDateLabel(selectedDate) : '날짜를 선택하세요'}</h2>
        </div>
        <div className="event-detail-heading-actions">
          <button
            aria-label={isDetailExpanded ? '상세 축소' : '상세 확장'}
            className="event-detail-expand-button"
            disabled={!selectedDate}
            onClick={(clickEvent) => {
              clickEvent.stopPropagation()
              setDetailExpanded((current) => !current)
            }}
            type="button"
          >
            {isDetailExpanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
          </button>
          <CalendarDays size={22} aria-hidden="true" />
        </div>
      </div>

      <div className="event-detail-list" aria-busy={isLoading}>
        {selectedDate && isLoading ? (
          <p className="event-detail-loading-status" role="status">
            상세 정보를 불러오는 중입니다.
          </p>
        ) : null}
        {!selectedDate ? (
          <EmptyState
            title="날짜를 선택하세요"
            description="달력에서 날짜를 선택하여 해당 날짜의 일정을 확인하세요."
            icon={<CalendarDays size={28} />}
          />
        ) : selectedEvents.length > 0 ? (
          selectedEvents.map((event) => {
            const detail = eventDetails[event.id]?.data
            const matchingOccurrence = event.occurrences.find((occurrence: EventOccurrence) =>
              selectedDate ? occurrenceDateKeys(occurrence).includes(selectedDate) : false,
            )
            const firstSns = detail?.links.sns?.[0]
            const embeddedLinks = detail?.links.sns?.filter(isEmbeddableXPost) ?? []
            const occurrenceTime = matchingOccurrence ? formatOccurrenceTime(matchingOccurrence) : null
            const title = localizedText(event.title, 'ko', ['ja', 'en'])
            const primaryUrl = firstSns?.url ?? detail?.links.official

            return (
              <article className="event-detail-card" data-event-type={event.type} key={event.id}>
                <div className="event-detail-card-title flex justify-between items-start gap-4">
                  {primaryUrl ? (
                    <a href={primaryUrl} rel="noreferrer" target="_blank" className="flex items-center gap-1">
                      {title}
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="event-detail-title">{title}</span>
                  )}
                  <Token
                    color={eventColorMap[event.type] ?? 'default'}
                    label={eventTypeLabels[event.type]}
                    size="sm"
                  />
                </div>
                {occurrenceTime ? <p className="event-detail-time">{occurrenceTime}</p> : null}
                {detail?.summary ? <p className="event-detail-summary">{localizedText(detail.summary, 'ko', ['ja', 'en'])}</p> : null}
                {detail?.location ? (
                  <p className="event-detail-location">
                    {[detail.location.venue, detail.location.region]
                      .map((value) => (value ? localizedText(value, 'ko', ['ja', 'en']) : null))
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : null}
                {embeddedLinks.length > 0 ? (
                  <div className="event-embed-stack">
                    {embeddedLinks.map((link: EventLink) => (
                      <XPostEmbed key={`${link.platform}-${link.url}`} link={link} />
                    ))}
                  </div>
                ) : null}
                <div className="event-link-row">
                  {detail?.links.sns?.map((link: EventLink) => (
                    <a href={link.url} key={`${link.platform}-${link.url}`} rel="noreferrer" target="_blank">
                      {eventPlatformLabels[link.platform]}
                    </a>
                  ))}
                  {detail?.links.official ? <a href={detail.links.official} rel="noreferrer" target="_blank">Official</a> : null}
                  {detail?.links.ticket ? <a href={detail.links.ticket} rel="noreferrer" target="_blank">Ticket</a> : null}
                </div>
                <Button
                  label="수정 요청"
                  variant="secondary"
                  onClick={() => setDialog({ kind: 'edit', event, occurrence: matchingOccurrence })}
                  className="event-edit-button mt-3"
                />
              </article>
            )
          })
        ) : (
          <EmptyState
            title="예정된 이벤트가 없습니다"
            description={`선택하신 날짜(${formatDateLabel(selectedDate)})에 예정된 이벤트가 없습니다.`}
            icon={<CalendarDays size={28} />}
            actions={
              <Button
                label="일정 제보하기"
                variant="secondary"
                onClick={() => setDialog({ kind: 'add' })}
              />
            }
          />
        )}
      </div>
    </aside>
  )
}
