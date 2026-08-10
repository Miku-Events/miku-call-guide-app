import {
  AlertTriangle,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  Plus,
  RefreshCw,
} from 'lucide-react'
import './events.css'
import { useEffect, useMemo, useState } from 'react'
import {
  getRootManifestUrl,
  getSubmissionApiBaseUrl,
  isSubmissionReadOnlyEnvironment,
} from '../../app/config'
import { AppPageShell, StatusBanner } from '../../shared/layout/AppPageShell'
import {
  buildCalendarBarSegments,
  buildEventsByDate,
  compareCalendarEvents,
  groupBarsByWeek,
} from './calendarLayout'
import { eventPageWarning } from './eventWarnings'
import { useOverflowDragScroll } from './hooks/useOverflowDragScroll'
import { useEventCalendarController } from './hooks/useEventCalendarController'
import { useEventCalendarIndex } from './hooks/useEventCalendarIndex'
import { useEventDetails } from './hooks/useEventDetails'
import { useEventMonth } from './hooks/useEventMonth'
import { CalendarGrid } from './components/CalendarGrid'
import { EventDetailSheet } from './components/EventDetailSheet'
import { EventSubmitDialog } from './components/EventSubmitDialog'
import { Button } from '@astryxdesign/core/Button'
import { buildCalendarDays, calendarWeeks, formatMonthLabel } from './eventDate'
import type { EventDialogState } from './eventDialog'
import { eventTypePresentation, normalizeEventTypePriority } from './eventTypes'

export function EventCalendarPage() {
  const rootManifestUrl = getRootManifestUrl()
  const submissionApiBaseUrl = getSubmissionApiBaseUrl()
  const submissionReadOnly = isSubmissionReadOnlyEnvironment()
  
  // State
  const [dialog, setDialog] = useState<EventDialogState>(null)
  const [submissionSuccess, setSubmissionSuccess] = useState<string | null>(null)
  const {
    data: calendarIndex,
    error,
    isLoading: calendarIndexIsLoading,
    retry: retryCalendarIndex,
  } = useEventCalendarIndex(rootManifestUrl)
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

  // Calendar reset scroll
  useEffect(() => {
    const panel = calendarRef.current
    if (!panel) return
    panel.scrollLeft = 0
    panel.scrollTop = 0
  }, [calendarRef, visibleMonth])

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
    !activeError && (calendarIndexIsLoading || !calendarIndex || monthIsLoading || !monthResult),
  )
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
                  <span>{eventTypePresentation[type].shortLabel}</span>
                </button>
              ))}
            </div>
            {submissionReadOnly ? (
              <span className="event-read-only-label">미리보기 · 읽기 전용</span>
            ) : (
              <Button
                label="일정 추가"
                onClick={() => setDialog({ kind: 'add' })}
                icon={<Plus size={14} aria-hidden="true" />}
                variant="primary"
                className="event-add-compact-button"
              />
            )}
          </div>
        </div>
      }
    >
      {submissionReadOnly ? (
        <StatusBanner icon={<LockKeyhole size={18} aria-hidden="true" />} role="status" variant="info">
          이 미리보기 환경은 읽기 전용입니다. 로그인, 일정 제보, 수정 요청은 canonical 운영 도메인에서만 사용할 수 있습니다.
        </StatusBanner>
      ) : null}

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
              onClick={retryCalendarIndex}
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

      <div className="event-calendar-layout" data-detail-expanded={Boolean(selectedDate) && detailExpanded}>
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
            openDateDetail={openDateDetail}
            selectedDate={selectedDate}
            todayKey={todayKey}
            visibleMonth={visibleMonth}
            weeks={weeks}
          />
        </section>

        <EventDetailSheet
          detailExpanded={detailExpanded}
          eventDetails={selectedEventDetails}
          isLoading={isDetailLoading}
          selectedDate={selectedDate}
          selectedEvents={selectedEvents}
          onDismiss={closeEventDetail}
          setDetailExpanded={setDetailExpanded}
          setDialog={setDialog}
          submissionReadOnly={submissionReadOnly}
        />
      </div>

      {!submissionReadOnly ? (
        <EventSubmitDialog
          dialog={dialog}
          setDialog={setDialog}
          setSubmissionSuccess={setSubmissionSuccess}
          submissionApiBaseUrl={submissionApiBaseUrl}
        />
      ) : null}
    </AppPageShell>
  )
}
