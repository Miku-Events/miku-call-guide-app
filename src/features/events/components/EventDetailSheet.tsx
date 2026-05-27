import { type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { CalendarDays, ExternalLink, Maximize2, Minimize2 } from 'lucide-react'
import { localizedText } from '../../callGuide/callPositioning'
import type { CalendarEventSummary, EventGuide, EventLink, EventOccurrence, LoadResult } from '../../data/types'
import { occurrenceDateKeys } from '../calendarLayout'
import { isEmbeddableXPost } from '../eventEmbeds'
import { XPostEmbed } from '../XPostEmbed'

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
  if (!occurrence.startsAt) {
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
  isDetailExpanded: boolean
  detailExpanded: boolean
  setDetailExpanded: React.Dispatch<React.SetStateAction<boolean>>
  detailDismissDragY: number
  detailDismissHandleProps: any
  detailDismissDragging: boolean
  detailCanDrag: boolean
  detailIsDragging: boolean
  detailDragScrollProps: any
  detailRef: React.RefObject<HTMLElement | null>
  setDialog: React.Dispatch<React.SetStateAction<DialogState>>
}

export function EventDetailSheet({
  selectedDate,
  selectedEvents,
  eventDetails,
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
      className="event-detail-panel"
      data-dismiss-dragging={detailDismissDragging}
      data-dragging={detailIsDragging}
      data-expanded={isDetailExpanded}
      data-open={Boolean(selectedDate)}
      data-scrollable={detailCanDrag}
      aria-label="Selected day events"
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
          <h2>{selectedDate ? formatDateLabel(selectedDate) : '날짜를 선택하세요'}</h2>
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

      <div className="event-detail-list">
        {!selectedDate ? (
          <div className="event-empty-state">
            <div className="event-empty-icon" aria-hidden="true">
              <CalendarDays size={28} />
            </div>
            <p>달력에서 날짜를 선택하여 해당 날짜의 일정을 확인하세요.</p>
          </div>
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

            return (
              <article className="event-detail-card" data-event-type={event.type} key={event.id}>
                <div className="event-detail-card-title">
                  <a href={firstSns?.url ?? detail?.links.official ?? '#'} rel="noreferrer" target="_blank">
                    {title}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  <span>{eventTypeLabels[event.type]}</span>
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
                <button
                  className="event-edit-button"
                  onClick={() => setDialog({ kind: 'edit', event, occurrence: matchingOccurrence })}
                  type="button"
                >
                  수정 요청
                </button>
              </article>
            )
          })
        ) : (
          <div className="event-empty-state">
            <div className="event-empty-icon" aria-hidden="true">
              <CalendarDays size={28} />
            </div>
            <p>선택하신 날짜({formatDateLabel(selectedDate)})에 예정된 이벤트가 없습니다.</p>
            <button
              className="app-secondary-button"
              onClick={() => setDialog({ kind: 'add' })}
              type="button"
              style={{ marginTop: '0.5rem' }}
            >
              일정 제보하기
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
