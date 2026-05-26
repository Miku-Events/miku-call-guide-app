import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Github,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Send,
  X,
} from 'lucide-react'
import {
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getRootManifestUrl, getSubmissionApiBaseUrl } from '../../app/config'
import { AppPageShell, StatusBanner } from '../../shared/layout/AppPageShell'
import { localizedText } from '../callGuide/callPositioning'
import {
  fetchEventCalendarIndex,
  fetchEventCalendarMonth,
  fetchEventDetail,
} from '../data/fetchManifest'
import type {
  CalendarEventSummary,
  EventCalendarIndex,
  EventCalendarMonth,
  EventGuide,
  EventLink,
  EventOccurrence,
  EventType,
  LoadResult,
} from '../data/types'
import {
  fetchSubmissionSession,
  githubLoginUrl,
  submitEditRequest,
  submitEventSubmission,
  type SubmissionSession,
} from './submissionClient'
import { TurnstileWidget } from '../../components/TurnstileWidget'
import {
  buildCalendarBarSegments,
  buildEventsByDate,
  compareCalendarEvents,
  groupBarsByWeek,
  occurrenceDateKeys,
} from './calendarLayout'
import { isEmbeddableXPost } from './eventEmbeds'
import { XPostEmbed } from './XPostEmbed'

const eventTypeLabels: Record<EventType, string> = {
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
type DayKind = 'weekday' | 'saturday' | 'sunday'
type DialogState =
  | { kind: 'add' }
  | { kind: 'edit'; event: CalendarEventSummary; occurrence?: EventOccurrence }
  | null

interface MonthLoadResult extends LoadResult<EventCalendarMonth> {
  url: string
}

interface OverflowDragScrollResult<T extends HTMLElement> {
  ref: React.RefObject<T | null>
  canDrag: boolean
  isDragging: boolean
  dragScrollProps: {
    onClickCapture: (event: React.MouseEvent<T>) => void
    onMouseDownCapture: () => void
    onPointerCancel: (event: ReactPointerEvent<T>) => void
    onPointerDownCapture: (event: ReactPointerEvent<T>) => void
    onPointerMove: (event: ReactPointerEvent<T>) => void
    onPointerUp: (event: ReactPointerEvent<T>) => void
  }
}

interface SheetDismissHandleResult {
  dragY: number
  isDragging: boolean
  handleProps: {
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
    onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  }
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function dateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dayKindFromDateKey(dateKey: string): DayKind {
  const [year, month, date] = dateKey.split('-').map(Number)
  const day = new Date(year, month - 1, date).getDay()
  if (day === 0) {
    return 'sunday'
  }
  if (day === 6) {
    return 'saturday'
  }
  return 'weekday'
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

function isScrollable(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
}

function shouldIgnoreDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [data-sheet-dismiss-handle="true"]'))
}

function shouldDismissSheet(deltaY: number, elapsedMs: number): boolean {
  const velocity = deltaY / Math.max(1, elapsedMs)
  return deltaY >= 72 || (deltaY >= 32 && velocity >= 0.6)
}

function useOverflowDragScroll<T extends HTMLElement>(): OverflowDragScrollResult<T> {
  const ref = useRef<T>(null)
  const dragStateRef = useRef<{
    captured: boolean
    moved: boolean
    pointerId: number
    scrollLeft: number
    scrollTop: number
    x: number
    y: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [canDrag, setCanDrag] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const updateCanDrag = () => setCanDrag(isScrollable(element))
    updateCanDrag()

    const observer = new ResizeObserver(updateCanDrag)
    observer.observe(element)
    Array.from(element.children).forEach((child) => observer.observe(child))
    const mutationObserver = new MutationObserver(updateCanDrag)
    mutationObserver.observe(element, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutationObserver.disconnect()
    }
  }, [])

  const endDrag = useCallback((event: ReactPointerEvent<T>) => {
    const state = dragStateRef.current
    if (!state) {
      return
    }

    if (event.currentTarget.hasPointerCapture(state.pointerId)) {
      event.currentTarget.releasePointerCapture(state.pointerId)
    }
    dragStateRef.current = null
    setIsDragging(false)

    if (state.moved) {
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
  }, [])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<T>) => {
      const element = ref.current
      if (!element || event.button !== 0 || shouldIgnoreDragTarget(event.target) || !isScrollable(element)) {
        return
      }

      suppressClickRef.current = false
      setCanDrag(true)
      dragStateRef.current = {
        captured: false,
        moved: false,
        pointerId: event.pointerId,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        x: event.clientX,
        y: event.clientY,
      }
    },
    [],
  )

  const onPointerMove = useCallback((event: ReactPointerEvent<T>) => {
    const state = dragStateRef.current
    const element = ref.current
    if (!state || !element) {
      return
    }

    const deltaX = event.clientX - state.x
    const deltaY = event.clientY - state.y
    if (!state.moved && Math.hypot(deltaX, deltaY) < 5) {
      return
    }

    if (!state.captured) {
      event.currentTarget.setPointerCapture(state.pointerId)
      state.captured = true
    }
    state.moved = true
    setIsDragging(true)
    element.scrollLeft = state.scrollLeft - deltaX
    element.scrollTop = state.scrollTop - deltaY
    event.preventDefault()
  }, [])

  const onClickCapture = useCallback((event: React.MouseEvent<T>) => {
    if (!suppressClickRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
  }, [])

  const onMouseDownCapture = useCallback(() => {
    suppressClickRef.current = false
  }, [])

  return {
    ref,
    canDrag,
    isDragging,
    dragScrollProps: {
      onClickCapture,
      onMouseDownCapture,
      onPointerCancel: endDrag,
      onPointerDownCapture: onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
    },
  }
}

function useSheetDismissHandle(enabled: boolean, onDismiss: () => void): SheetDismissHandleResult {
  const dragStateRef = useRef<{
    lastDeltaY: number
    moved: boolean
    pointerId: number
    startTime: number
    x: number
    y: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const resetDrag = useCallback(() => {
    dragStateRef.current = null
    setDragY(0)
    setIsDragging(false)
  }, [])

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const state = dragStateRef.current
      if (!state) {
        return
      }

      if (event.currentTarget.hasPointerCapture(state.pointerId)) {
        event.currentTarget.releasePointerCapture(state.pointerId)
      }

      const deltaY = Math.max(state.lastDeltaY, event.clientY - state.y, 0)
      const elapsedMs = window.performance.now() - state.startTime
      const shouldDismiss = shouldDismissSheet(deltaY, elapsedMs)

      if (state.moved) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }

      resetDrag()

      if (shouldDismiss) {
        onDismiss()
      }
    },
    [onDismiss, resetDrag],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled || event.button !== 0) {
        return
      }

      suppressClickRef.current = false
      dragStateRef.current = {
        lastDeltaY: 0,
        moved: false,
        pointerId: event.pointerId,
        startTime: window.performance.now(),
        x: event.clientX,
        y: event.clientY,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [enabled],
  )

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current
    if (!state) {
      return
    }

    const deltaX = event.clientX - state.x
    const deltaY = event.clientY - state.y
    if (!state.moved && Math.hypot(deltaX, deltaY) < 5) {
      return
    }

    state.moved = true
    state.lastDeltaY = Math.max(0, deltaY)
    setIsDragging(true)
    setDragY(state.lastDeltaY)
    event.preventDefault()
  }, [])

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        event.preventDefault()
        event.stopPropagation()
        suppressClickRef.current = false
        return
      }

      if (enabled) {
        onDismiss()
      }
    },
    [enabled, onDismiss],
  )

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!enabled || event.button !== 0) {
        return
      }

      if (dragStateRef.current && dragStateRef.current.pointerId !== -1) {
        return
      }

      const state = {
        lastDeltaY: 0,
        moved: false,
        pointerId: -1,
        startTime: window.performance.now(),
        x: event.clientX,
        y: event.clientY,
      }
      dragStateRef.current = state
      suppressClickRef.current = false

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - state.x
        const deltaY = moveEvent.clientY - state.y
        if (!state.moved && Math.hypot(deltaX, deltaY) < 5) {
          return
        }

        state.moved = true
        state.lastDeltaY = Math.max(0, deltaY)
        setIsDragging(true)
        setDragY(state.lastDeltaY)
        moveEvent.preventDefault()
      }

      const handleMouseUp = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)

        const deltaY = Math.max(state.lastDeltaY, upEvent.clientY - state.y, 0)
        const shouldDismiss = shouldDismissSheet(deltaY, window.performance.now() - state.startTime)

        if (state.moved) {
          suppressClickRef.current = true
          window.setTimeout(() => {
            suppressClickRef.current = false
          }, 0)
        }

        resetDrag()

        if (shouldDismiss) {
          onDismiss()
        }
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      event.preventDefault()
    },
    [enabled, onDismiss, resetDrag],
  )

  return {
    dragY,
    isDragging,
    handleProps: {
      onClick,
      onMouseDown,
      onPointerCancel: finishDrag,
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
    },
  }
}

function makeEmptyMonth(month: string, indexUrl: string): MonthLoadResult {
  return {
    data: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      dataVersion: 'empty',
      month,
      events: [],
    },
    source: 'network',
    url: new URL(`months/${month}.json`, indexUrl).toString(),
  }
}

export function EventCalendarPage() {
  const rootManifestUrl = getRootManifestUrl()
  const submissionApiBaseUrl = getSubmissionApiBaseUrl()
  const [calendarIndex, setCalendarIndex] = useState<(LoadResult<EventCalendarIndex> & { url: string }) | null>(null)
  const [monthResult, setMonthResult] = useState<MonthLoadResult | null>(null)
  const [eventDetails, setEventDetails] = useState<Record<string, LoadResult<EventGuide>>>({})
  const [visibleMonth, setVisibleMonth] = useState(() => monthKeyFromDate(new Date()))
  const [todayKey] = useState(() => dateKeyFromDate(new Date()))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [detailExpanded, setDetailExpanded] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [session, setSession] = useState<SubmissionSession>({ authenticated: false })
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const {
    canDrag: calendarCanDrag,
    dragScrollProps: calendarDragScrollProps,
    isDragging: calendarIsDragging,
    ref: calendarRef,
  } = useOverflowDragScroll<HTMLElement>()
  const {
    canDrag: filterCanDrag,
    dragScrollProps: filterDragScrollProps,
    isDragging: filterIsDragging,
    ref: filterRef,
  } = useOverflowDragScroll<HTMLDivElement>()
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

  useEffect(() => {
    const panel = calendarRef.current
    if (!panel) {
      return
    }

    panel.scrollLeft = 0
    panel.scrollTop = 0
  }, [calendarRef, visibleMonth])

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

  useEffect(() => {
    let cancelled = false

    async function loadMonth() {
      if (!calendarIndex) {
        return
      }

      try {
        const result = calendarIndex.data.availableMonths.includes(visibleMonth)
          ? await fetchEventCalendarMonth(calendarIndex.url, visibleMonth)
          : makeEmptyMonth(visibleMonth, calendarIndex.url)

        if (!cancelled) {
          setMonthResult(result)
          setSelectedDate(null)
          setDetailExpanded(false)
          setError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setMonthResult(null)
          setError(loadError instanceof Error ? loadError.message : 'Event calendar month load failed.')
        }
      }
    }

    void loadMonth()

    return () => {
      cancelled = true
    }
  }, [calendarIndex, visibleMonth])

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

  useEffect(() => {
    const dialogEl = dialogRef.current
    if (!dialogEl) return

    if (dialog) {
      if (!dialogEl.open) {
        dialogEl.showModal()
      }
    } else {
      if (dialogEl.open) {
        dialogEl.close()
      }
    }
  }, [dialog])

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
  const isDetailExpanded = Boolean(selectedDate) && detailExpanded
  const openDateDetail = useCallback((dateKey: string) => {
    setSelectedDate(dateKey)
    setDetailExpanded(window.matchMedia('(min-width: 981px)').matches)
  }, [])
  const handleDetailPanelClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
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
    },
    [detailExpanded, selectedDate],
  )
  const warning = calendarIndex?.warning ?? monthResult?.warning

  useEffect(() => {
    let cancelled = false

    async function loadDetails() {
      if (!monthResult || selectedEvents.length === 0) {
        return
      }

      const missing = selectedEvents.filter((event) => !eventDetails[event.id])
      if (missing.length === 0) {
        return
      }

      const loaded = await Promise.all(
        missing.map(async (event) => [event.id, await fetchEventDetail(monthResult.url, event.path, event.id)] as const),
      )

      if (!cancelled) {
        setEventDetails((current) => ({
          ...current,
          ...Object.fromEntries(loaded),
        }))
      }
    }

    void loadDetails().catch((loadError) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : 'Event detail load failed.')
      }
    })

    return () => {
      cancelled = true
    }
  }, [eventDetails, monthResult, selectedEvents])

  const openLogin = () => {
    if (!submissionApiBaseUrl) {
      setSubmissionMessage('Submission API가 설정되지 않았습니다.')
      return
    }

    window.location.href = githubLoginUrl(submissionApiBaseUrl, window.location.href)
  }

  const handleAddSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setSubmissionMessage(null)
    try {
      const result = await submitEventSubmission(submissionApiBaseUrl, {
        title: String(form.get('title') ?? ''),
        type: String(form.get('type') ?? ''),
        startsAt: String(form.get('startsAt') ?? ''),
        endsAt: String(form.get('endsAt') ?? '') || undefined,
        timezone: String(form.get('timezone') ?? ''),
        snsUrl: String(form.get('snsUrl') ?? ''),
        sourceUrl: String(form.get('sourceUrl') ?? '') || undefined,
        note: String(form.get('note') ?? '') || undefined,
        turnstileToken: turnstileToken || '',
      })
      setSubmissionMessage(result.url ? `PR 생성 요청이 접수되었습니다: ${result.url}` : 'PR 생성 요청이 접수되었습니다.')
      setDialog(null)
      setTurnstileToken(null)
    } catch (submitError) {
      setSubmissionMessage(submitError instanceof Error ? submitError.message : '일정 추가 요청에 실패했습니다.')
      setTurnstileToken(null)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dialog || dialog.kind !== 'edit') {
      return
    }

    const form = new FormData(event.currentTarget)
    setSubmitting(true)
    setSubmissionMessage(null)
    try {
      const result = await submitEditRequest(submissionApiBaseUrl, {
        eventId: dialog.event.id,
        occurrenceId: dialog.occurrence?.id,
        message: String(form.get('message') ?? ''),
        sourceUrl: String(form.get('sourceUrl') ?? '') || undefined,
        turnstileToken: turnstileToken || '',
      })
      setSubmissionMessage(result.url ? `수정 요청 이슈가 생성되었습니다: ${result.url}` : '수정 요청 이슈가 생성되었습니다.')
      setDialog(null)
      setTurnstileToken(null)
    } catch (submitError) {
      setSubmissionMessage(submitError instanceof Error ? submitError.message : '수정 요청에 실패했습니다.')
      setTurnstileToken(null)
    } finally {
      setSubmitting(false)
    }
  }

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
        <>
          <div className="event-month-controls">
            <button aria-label="Previous month" onClick={() => setVisibleMonth((month) => addMonths(month, -1))} type="button">
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <strong>{formatMonthLabel(visibleMonth)}</strong>
            <button aria-label="Next month" onClick={() => setVisibleMonth((month) => addMonths(month, 1))} type="button">
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="event-toolbar-trailing">
            <div
              className="event-type-filters"
              aria-label="Event type filter"
              data-dragging={filterIsDragging}
              data-scrollable={filterCanDrag}
              ref={filterRef}
              {...filterDragScrollProps}
            >
              <button data-active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} type="button">All</button>
              {availableTypes.map((type) => (
                <button data-active={typeFilter === type} data-event-type={type} key={type} onClick={() => setTypeFilter(type)} type="button">
                  {eventTypeLabels[type]}
                </button>
              ))}
            </div>
            <button className="event-add-compact-button" onClick={() => setDialog({ kind: 'add' })} type="button">
              <Plus size={14} aria-hidden="true" />
              일정 추가
            </button>
          </div>
        </>
      }
    >
        {warning ? (
          <StatusBanner icon={<AlertTriangle size={18} aria-hidden="true" />} variant="warning">
            {warning}
          </StatusBanner>
        ) : null}

        {submissionMessage ? (
          <StatusBanner icon={<Github size={18} aria-hidden="true" />} variant="info">
            {submissionMessage}
          </StatusBanner>
        ) : null}

        {error ? (
          <StatusBanner
            action={(
              <button className="app-secondary-button" onClick={loadIndex} type="button">
                <RefreshCw size={15} aria-hidden="true" />
                다시 시도
              </button>
            )}
            icon={<AlertTriangle size={18} aria-hidden="true" />}
            role="alert"
            variant="error"
          >
            {error}
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
                <span data-day-kind={dayKind} key={day}>{day}</span>
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
                      return (
                        <button
                          className="event-day-cell"
                          data-day-kind={dayKind}
                          data-in-month={inMonth}
                          data-selected={selectedDate === dateKey}
                          data-today={todayKey === dateKey}
                          key={dateKey}
                          onClick={() => openDateDetail(dateKey)}
                          type="button"
                        >
                          <span className="event-day-number">{Number(dateKey.slice(-2))}</span>
                        </button>
                      )
                    })}
                    {weekBars.length > 0 ? (
                      <div className="event-span-bars" aria-label="Calendar events">
                        {weekBars.map((segment) => {
                          const title = localizedText(segment.event.title, 'ko', ['ja', 'en'])
                          const barStyle = {
                            gridColumn: `${segment.columnStart} / ${segment.columnEnd}`,
                            '--event-bar-lane': segment.lane,
                          } as CSSProperties

                          return (
                            <button
                              aria-label={`${title}: ${formatDateLabel(segment.dateKeyStart)} - ${formatDateLabel(segment.dateKeyEnd)}`}
                              className="event-span-bar"
                              data-continues-after={segment.continuesAfter}
                              data-continues-before={segment.continuesBefore}
                              data-event-id={segment.event.id}
                              data-event-type={segment.event.type}
                              data-occurrence-id={segment.occurrence.id}
                              data-selected={selectedDate ? segment.dateKeys.includes(selectedDate) : false}
                              key={`${segment.event.id}-${segment.occurrence.id}-${segment.rowIndex}`}
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation()
                                openDateDetail(segment.dateKeyStart)
                              }}
                              onMouseUp={() => {
                                if (!calendarIsDragging) {
                                  openDateDetail(segment.dateKeyStart)
                                }
                              }}
                              onPointerUp={(pointerEvent) => {
                                if (!calendarIsDragging && pointerEvent.pointerType !== 'mouse') {
                                  openDateDetail(segment.dateKeyStart)
                                }
                              }}
                              style={barStyle}
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
          </section>

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
                  const matchingOccurrence = event.occurrences.find((occurrence) =>
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
                          {embeddedLinks.map((link) => (
                            <XPostEmbed key={`${link.platform}-${link.url}`} link={link} />
                          ))}
                        </div>
                      ) : null}
                      <div className="event-link-row">
                        {detail?.links.sns?.map((link) => (
                          <a href={link.url} key={`${link.platform}-${link.url}`} rel="noreferrer" target="_blank">
                            {eventPlatformLabels[link.platform]}
                          </a>
                        ))}
                        {detail?.links.official ? <a href={detail.links.official} rel="noreferrer" target="_blank">Official</a> : null}
                        {detail?.links.ticket ? <a href={detail.links.ticket} rel="noreferrer" target="_blank">Ticket</a> : null}
                      </div>
                      <button className="event-edit-button" onClick={() => setDialog({ kind: 'edit', event, occurrence: matchingOccurrence })} type="button">
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
                  <button className="app-secondary-button" onClick={() => setDialog({ kind: 'add' })} type="button" style={{ marginTop: '0.5rem' }}>
                    일정 제보하기
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>

      <dialog
        ref={dialogRef}
        className="event-dialog-backdrop"
        onClose={() => setDialog(null)}
      >
        {dialog ? (
          <div className="event-dialog">
            <div className="event-dialog-header">
              <div>
                <p>{session.authenticated ? `@${session.login ?? 'github-user'}` : 'GitHub login required'}</p>
                <h2>{dialog.kind === 'add' ? '일정 추가' : '수정 요청'}</h2>
              </div>
              <button aria-label="Close dialog" onClick={() => setDialog(null)} type="button">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            {!session.authenticated ? (
              <div className="event-login-panel">
                <p>GitHub 로그인 후 요청을 제출할 수 있습니다.</p>
                <button className="app-primary-button" onClick={openLogin} type="button">
                  <Github size={16} aria-hidden="true" />
                  GitHub 로그인
                </button>
              </div>
            ) : dialog.kind === 'add' ? (
              <form className="event-form" onSubmit={handleAddSubmit}>
                <label>
                  이벤트 제목
                  <input name="title" required />
                </label>
                <label>
                  종류
                  <select name="type" required>
                    {(availableTypes.length > 0 ? availableTypes : eventTypePriority).map((type) => (
                      <option key={type} value={type}>{eventTypeLabels[type]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  시작 시간
                  <input name="startsAt" placeholder="2026-08-15T18:00:00+09:00" required />
                </label>
                <label>
                  종료 시간
                  <input name="endsAt" placeholder="2026-08-15T20:30:00+09:00" />
                </label>
                <label>
                  타임존
                  <input defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} name="timezone" required />
                </label>
                <label>
                  SNS 링크
                  <input name="snsUrl" placeholder="https://x.com/..." required />
                </label>
                <label>
                  근거 링크
                  <input name="sourceUrl" placeholder="https://..." />
                </label>
                <label>
                  메모
                  <textarea name="note" rows={4} />
                </label>
                <TurnstileWidget onVerify={setTurnstileToken} />
                <button className="app-primary-button" disabled={submitting || !turnstileToken} type="submit">
                  <Send size={16} aria-hidden="true" />
                  PR 요청
                </button>
              </form>
            ) : (
              <form className="event-form" onSubmit={handleEditSubmit}>
                <label>
                  대상 이벤트
                  <input readOnly value={dialog.event.id} />
                </label>
                <label>
                  수정 요청 내용
                  <textarea name="message" required rows={5} />
                </label>
                <label>
                  근거 링크
                  <input name="sourceUrl" placeholder="https://..." />
                </label>
                <TurnstileWidget onVerify={setTurnstileToken} />
                <button className="app-primary-button" disabled={submitting || !turnstileToken} type="submit">
                  <Send size={16} aria-hidden="true" />
                  Issue 생성
                </button>
              </form>
            )}
          </div>
        ) : null}
      </dialog>
    </AppPageShell>
  )
}
