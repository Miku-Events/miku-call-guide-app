import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
} from 'lucide-react'
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
  fetchEventDetail,
} from '../data/fetchManifest'
import type {
  CalendarEventSummary,
  EventCalendarIndex,
  EventGuide,
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

type TypeFilter = 'all' | EventType
type DialogState =
  | { kind: 'add' }
  | { kind: 'edit'; event: CalendarEventSummary; occurrence?: EventOccurrence }
  | null

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function dateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseMonthKey(month: string): Date {
  const [year, monthIndex] = month.split('-').map(Number)
  return new Date(year, monthIndex - 1, 1)
}

function addMonths(month: string, delta: number): string {
  const date = parseMonthKey(month)
  date.setMonth(date.getMonth() + delta)
  return monthKeyFromDate(date)
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

function eventDetailKey(dataVersion: string, eventId: string): string {
  return JSON.stringify([dataVersion, eventId])
}

export function EventCalendarPage() {
  const rootManifestUrl = getRootManifestUrl()
  const submissionApiBaseUrl = getSubmissionApiBaseUrl()
  
  // State
  const [calendarIndex, setCalendarIndex] = useState<(LoadResult<EventCalendarIndex> & { url: string }) | null>(null)
  const [visibleMonth, setVisibleMonth] = useState(() => monthKeyFromDate(new Date()))
  const [todayKey] = useState(() => dateKeyFromDate(new Date()))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [detailExpanded, setDetailExpanded] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [session, setSession] = useState<SubmissionSession>({ authenticated: false })
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null)
  const [eventDetails, setEventDetails] = useState<Record<string, LoadResult<EventGuide>>>({})

  const resetSelection = useCallback(() => {
    setSelectedDate(null)
    setDetailExpanded(false)
  }, [])

  // Custom fetching hook with abortable controls
  const { data: monthResult, error: monthError } = useEventMonth(
    calendarIndex,
    visibleMonth,
    resetSelection
  )

  const activeError = error || monthError

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

  const closeEventDetail = useCallback(() => {
    setSelectedDate(null)
    setDetailExpanded(false)
  }, [])

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
  const selectedEventDetails = useMemo(() => {
    const currentDetails: Record<string, LoadResult<EventGuide>> = {}
    const dataVersion = monthResult?.data.dataVersion
    if (!dataVersion) return currentDetails

    for (const event of selectedEvents) {
      const detail = eventDetails[eventDetailKey(dataVersion, event.id)]
      if (detail) {
        currentDetails[event.id] = detail
      }
    }

    return currentDetails
  }, [eventDetails, monthResult?.data.dataVersion, selectedEvents])
  const isDetailExpanded = Boolean(selectedDate) && detailExpanded
  const warning = eventPageWarning(
    calendarIndex?.warning,
    monthResult?.warning,
    selectedEvents,
    selectedEventDetails,
  )

  const openDateDetail = useCallback((dateKey: string) => {
    setSelectedDate(dateKey)
    setDetailExpanded(window.matchMedia('(min-width: 981px)').matches)
  }, [])

  // Fetch occurrence details when selected
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    async function loadDetails() {
      if (!monthResult || selectedEvents.length === 0) return

      const dataVersion = monthResult.data.dataVersion
      const missing = selectedEvents.filter((event) => !eventDetails[eventDetailKey(dataVersion, event.id)])
      if (missing.length === 0) return

      const loaded = await Promise.all(
        missing.map(async (event) => [eventDetailKey(dataVersion, event.id), await fetchEventDetail(monthResult.url, event.path, event.id, {
          expectedDataVersion: dataVersion,
          signal: controller.signal,
        })] as const),
      )

      if (!cancelled) {
        setEventDetails((current) => ({
          ...current,
          ...Object.fromEntries(loaded),
        }))
      }
    }

    void loadDetails().catch((loadError) => {
      if (loadError && typeof loadError === 'object' && 'name' in loadError && loadError.name === 'AbortError') {
        return
      }
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : 'Event detail load failed.')
      }
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [eventDetails, monthResult, selectedEvents])

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
          <div className="event-month-controls flex items-center gap-2">
            <Button
              label="Previous month"
              isIconOnly
              onClick={() => setVisibleMonth((month) => addMonths(month, -1))}
              icon={<ChevronLeft size={18} aria-hidden="true" />}
              variant="ghost"
            />
            <strong className="text-md min-w-[7rem] text-center">{formatMonthLabel(visibleMonth)}</strong>
            <Button
              label="Next month"
              isIconOnly
              onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
              icon={<ChevronRight size={18} aria-hidden="true" />}
              variant="ghost"
            />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="event-type-filters flex items-center bg-[var(--color-background-raised)] border border-[var(--color-border-subtle)] p-0.5 rounded-[var(--radius-element)]">
              <button
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

      {submissionMessage ? (
        <StatusBanner icon={<AlertTriangle size={18} aria-hidden="true" />} variant="info">
          {submissionMessage}
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
          className="event-calendar-panel"
          aria-label="Monthly event calendar"
          data-dragging={calendarIsDragging}
          data-scrollable={calendarCanDrag}
          ref={calendarRef}
          {...calendarDragScrollProps}
        >
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
        setSubmissionMessage={setSubmissionMessage}
        setTurnstileToken={setTurnstileToken}
        submissionApiBaseUrl={submissionApiBaseUrl}
        turnstileToken={turnstileToken}
      />
    </AppPageShell>
  )
}
