import {
  AlertTriangle,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
} from 'lucide-react'
import './events.css'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { getRootManifestUrl, getSubmissionApiBaseUrl } from '../../app/config'
import { AppPageShell, StatusBanner } from '../../shared/layout/AppPageShell'
import {
  fetchEventCalendarIndex,
} from '../data/fetchEventManifest'
import type {
  CalendarEventSummary,
  EventCalendarIndex,
  EventOccurrence,
  EventType,
  LoadResult,
} from '../data/types'
import {
  fetchSubmissionSession,
  type SubmissionSession,
} from './submissionClient'
import {
  buildCalendarBarSegments,
  buildEventsByDate,
  compareCalendarEvents,
  groupBarsByWeek,
} from './calendarLayout'
import { eventPageWarning } from './eventWarnings'
import { useOverflowDragScroll } from './hooks/useOverflowDragScroll'
import { useSheetDismissHandle } from './hooks/useSheetDismissHandle'
import { useEventCalendarController } from './hooks/useEventCalendarController'
import { useEventDetails } from './hooks/useEventDetails'
import { useEventMonth } from './hooks/useEventMonth'
import { CalendarGrid } from './components/CalendarGrid'
import { EventDetailSheet } from './components/EventDetailSheet'
import { EventSubmitDialog } from './components/EventSubmitDialog'
import { Button } from '@astryxdesign/core/Button'

const eventTypeLabels: Record<string, string> = {
  concert: 'Concert',
  dj: 'DJ',
  popup: 'Popup',
  ticketApplication: 'Ticket',
  ticketGeneralSale: 'General sale',
  livestream: 'Livestream',
  exhibition: 'Exhibition',
  collaboration: 'Collab',
  announcement: 'Notice',
  other: 'Other',
}

const defaultEventTypePriority: EventType[] = [
  'concert',
  'ticketApplication',
  'ticketGeneralSale',
  'livestream',
  'dj',
  'popup',
  'exhibition',
  'collaboration',
  'announcement',
  'other',
]

type DialogState =
  | { kind: 'add' }
  | { kind: 'edit'; event: CalendarEventSummary; occurrence?: EventOccurrence }
  | null

function dateKeyFromDate(date: Date): string {
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parseMonthKey(month: string): Date {
  const [year, monthIndex] = month.split('-').map(Number)
  return new Date(year, monthIndex - 1, 1)
}

function normalizeEventTypePriority(typePriority?: EventType[]): EventType[] {
  const supportedTypes = new Set(Object.keys(eventTypeLabels) as EventType[])
  const configured = (typePriority ?? []).filter(
    (type, index, values): type is EventType => supportedTypes.has(type) && values.indexOf(type) === index,
  )

  return [...configured, ...defaultEventTypePriority.filter((type) => !configured.includes(type))]
}

function formatMonthLabel(month: string): string {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', year: 'numeric' }).format(parseMonthKey(month))
}

function buildCalendarDays(month: string): string[] {
  const firstDay = parseMonthKey(month)
  const start = new Date(firstDay)
  start.setDate(1 - firstDay.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return dateKeyFromDate(date)
  })
}

function calendarWeeks(calendarDays: string[]): string[][] {
  const weeks: string[][] = []

  for (let index = 0; index < calendarDays.length; index += 7) {
    weeks.push(calendarDays.slice(index, index + 7))
  }

  return weeks
}

export function EventCalendarPage() {
  const rootManifestUrl = getRootManifestUrl()
  const submissionApiBaseUrl = getSubmissionApiBaseUrl()
  
  // State
  const [calendarIndex, setCalendarIndex] = useState<(LoadResult<EventCalendarIndex> & { url: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [session, setSession] = useState<SubmissionSession>({ authenticated: false })
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(null)
  const {
    closeEventDetail,
    detailExpanded,
    moveMonth,
    openDateDetail,
    resetSelection,
    selectedDate,
    setDetailExpanded,
    setTypeFilter,
    todayKey,
    typeFilter,
    visibleMonth,
  } = useEventCalendarController()

  // Custom fetching hook with abortable controls
  const { data: monthResult, error: monthError, isLoading: monthIsLoading } = useEventMonth(
    calendarIndex,
    visibleMonth,
    resetSelection
  )

  // Custom gesture hooks
  const {
    canDrag: calendarCanDrag,
    dragScrollProps: calendarDragScrollProps,
    isDragging: calendarIsDragging,
    ref: calendarRef,
  } = useOverflowDragScroll<HTMLElement>()

  const {
    canDrag: detailCanDrag,
    dragScrollProps: detailDragScrollProps,
    isDragging: detailIsDragging,
    ref: detailRef,
  } = useOverflowDragScroll<HTMLElement>()

  const {
    dragY: detailDismissDragY,
    handleProps: detailDismissHandleProps,
    isDragging: detailDismissDragging,
  } = useSheetDismissHandle(Boolean(selectedDate), closeEventDetail)

  // Calendar reset scroll
  useEffect(() => {
    const panel = calendarRef.current
    if (!panel) return
    panel.scrollLeft = 0
    panel.scrollTop = 0
  }, [calendarRef, visibleMonth])

  // Load calendar index
  const loadIndex = useCallback(async () => {
    try {
      const result = await fetchEventCalendarIndex(rootManifestUrl)
      setCalendarIndex(result)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Event calendar index load failed.')
    }
  }, [rootManifestUrl])

  useEffect(() => {
    let cancelled = false
    async function loadInitialIndex() {
      try {
        const result = await fetchEventCalendarIndex(rootManifestUrl)
        if (!cancelled) {
          setCalendarIndex(result)
          setError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Event calendar index load failed.')
        }
      }
    }
    void loadInitialIndex()
    return () => {
      cancelled = true
    }
  }, [rootManifestUrl])


  // Load authentication session
  useEffect(() => {
    let cancelled = false
    async function loadSession() {
      const result = await fetchSubmissionSession(submissionApiBaseUrl)
      if (!cancelled) {
        setSession(result)
      }
    }
    void loadSession().catch(() => {
      if (!cancelled) {
        setSession({ authenticated: false })
      }
    })
    return () => {
      cancelled = true
    }
  }, [submissionApiBaseUrl])

  useEffect(() => {
    document.title = '이벤트 캘린더 - 하츠네 미쿠 콜 가이드'
  }, [])

  // Event computations
  const eventTypePriority = useMemo(() => normalizeEventTypePriority(calendarIndex?.data.typePriority), [calendarIndex?.data.typePriority])
  const availableTypes = useMemo(() => {
    const types = calendarIndex?.data.types ?? []
    return eventTypePriority.filter((type) => types.includes(type))
  }, [calendarIndex?.data.types, eventTypePriority])
  
  const filteredEvents = useMemo(() => {
    const events = monthResult?.data.events ?? []
    const visibleEvents = typeFilter === 'all' ? events : events.filter((event) => event.type === typeFilter)
    return [...visibleEvents].sort((eventA, eventB) => compareCalendarEvents(eventTypePriority, eventA, eventB))
  }, [eventTypePriority, monthResult, typeFilter])

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth])
  const weeks = useMemo(() => calendarWeeks(calendarDays), [calendarDays])
  const eventsByDate = useMemo(() => buildEventsByDate(filteredEvents), [filteredEvents])
  const calendarBars = useMemo(() => buildCalendarBarSegments(filteredEvents, weeks, eventTypePriority), [eventTypePriority, filteredEvents, weeks])
  const barsByWeek = useMemo(() => groupBarsByWeek(calendarBars), [calendarBars])
  const selectedEvents = useMemo(() => (selectedDate ? eventsByDate.get(selectedDate) ?? [] : []), [eventsByDate, selectedDate])
  const {
    details: selectedEventDetails,
    error: detailError,
    isLoading: detailIsLoading,
  } = useEventDetails(monthResult, selectedEvents)
  const activeError = error || monthError || detailError
  const isDetailLoading = Boolean(selectedDate && detailIsLoading && !activeError)
  const isCalendarLoading = Boolean(
    !activeError && (!calendarIndex || monthIsLoading || !monthResult),
  )
  const isDetailExpanded = Boolean(selectedDate) && detailExpanded
  const warning = eventPageWarning(
    calendarIndex?.warning,
    monthResult?.warning,
    selectedEvents,
    selectedEventDetails,
  )

  return (
    <AppPageShell
      activeNav="events"
      className="event-shell"
      kicker="Schedule Board"
      summaryItems={[
        { label: 'Months', value: calendarIndex?.data.availableMonths.length ?? 0 },
        { label: 'This month', value: monthResult?.data.events.length ?? 0 },
      ]}
      title="Event Calendar"
      toolbar={
        <div className="flex items-center justify-between w-full flex-wrap gap-4">
          <div aria-label="월 이동" className="event-month-controls flex items-center gap-2" role="group">
            <Button
              label="Previous month"
              isIconOnly
              onClick={() => moveMonth(-1)}
              icon={<ChevronLeft size={18} aria-hidden="true" />}
              variant="ghost"
            />
            <strong className="text-md min-w-[7rem] text-center">{formatMonthLabel(visibleMonth)}</strong>
            <Button
              label="Next month"
              isIconOnly
              onClick={() => moveMonth(1)}
              icon={<ChevronRight size={18} aria-hidden="true" />}
              variant="ghost"
            />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div
              aria-label="이벤트 종류 필터"
              className="event-type-filters flex items-center bg-[var(--color-background-raised)] border border-[var(--color-border-subtle)] p-0.5 rounded-[var(--radius-element)]"
              role="group"
            >
              <button
                aria-pressed={typeFilter === 'all'}
                type="button"
                data-active={typeFilter === 'all' ? 'true' : 'false'}
                onClick={() => setTypeFilter('all')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-inner)] transition-all ${
                  typeFilter === 'all'
                    ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary-on-blend)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
                }`}
              >
                <span>All</span>
              </button>
              {availableTypes.map((type) => (
                <button
                  aria-pressed={typeFilter === type}
                  type="button"
                  key={type}
                  data-active={typeFilter === type ? 'true' : 'false'}
                  onClick={() => setTypeFilter(type)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-inner)] transition-all ${
                    typeFilter === type
                      ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary-on-blend)] shadow-sm'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
                  }`}
                >
                  <span>{eventTypeLabels[type]}</span>
                </button>
              ))}
            </div>
            <Button
              label="일정 추가"
              onClick={() => setDialog({ kind: 'add' })}
              icon={<Plus size={14} aria-hidden="true" />}
              variant="primary"
              className="event-add-compact-button"
            />
          </div>
        </div>
      }
    >
      {warning ? (
        <StatusBanner icon={<AlertTriangle size={18} aria-hidden="true" />} variant="warning">
          {warning}
        </StatusBanner>
      ) : null}

      {submissionSuccess ? (
        <StatusBanner
          icon={<CircleCheck size={18} aria-hidden="true" />}
          role="status"
          variant="info"
        >
          {submissionSuccess}
        </StatusBanner>
      ) : null}

      {activeError ? (
        <StatusBanner
          action={(
            <Button
              label="다시 시도"
              onClick={loadIndex}
              icon={<RefreshCw size={15} aria-hidden="true" />}
              variant="secondary"
            />
          )}
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          role="alert"
          variant="error"
        >
          {activeError}
        </StatusBanner>
      ) : null}

      <div className="event-calendar-layout" data-detail-expanded={isDetailExpanded}>
        <section
          aria-busy={isCalendarLoading}
          className="event-calendar-panel"
          aria-label="Monthly event calendar"
          data-dragging={calendarIsDragging}
          data-scrollable={calendarCanDrag}
          ref={calendarRef}
          {...calendarDragScrollProps}
        >
          {isCalendarLoading ? (
            <p className="event-loading-status" role="status">
              달력 데이터를 불러오는 중입니다.
            </p>
          ) : null}
          <CalendarGrid
            barsByWeek={barsByWeek}
            calendarIsDragging={calendarIsDragging}
            openDateDetail={openDateDetail}
            selectedDate={selectedDate}
            todayKey={todayKey}
            visibleMonth={visibleMonth}
            weeks={weeks}
          />
        </section>

        <EventDetailSheet
          detailCanDrag={detailCanDrag}
          detailDismissDragging={detailDismissDragging}
          detailDismissDragY={detailDismissDragY}
          detailDismissHandleProps={detailDismissHandleProps}
          detailDragScrollProps={detailDragScrollProps}
          detailExpanded={detailExpanded}
          detailIsDragging={detailIsDragging}
          detailRef={detailRef}
          eventDetails={selectedEventDetails}
          isLoading={isDetailLoading}
          isDetailExpanded={isDetailExpanded}
          selectedDate={selectedDate}
          selectedEvents={selectedEvents}
          setDetailExpanded={setDetailExpanded}
          setDialog={setDialog}
        />
      </div>

      <EventSubmitDialog
        dialog={dialog}
        session={session}
        setDialog={setDialog}
        setSubmissionSuccess={setSubmissionSuccess}
        setTurnstileToken={setTurnstileToken}
        submissionApiBaseUrl={submissionApiBaseUrl}
        turnstileToken={turnstileToken}
      />
    </AppPageShell>
  )
}
