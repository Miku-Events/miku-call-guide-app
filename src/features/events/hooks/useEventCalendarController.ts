import { useCallback, useState } from 'react'
import type { EventType } from '../../data/types'

export type EventTypeFilter = 'all' | EventType

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function dateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function addMonths(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number)
  const date = new Date(year, monthIndex - 1, 1)
  date.setMonth(date.getMonth() + delta)
  return monthKeyFromDate(date)
}

export function useEventCalendarController() {
  const [visibleMonth, setVisibleMonth] = useState(() => monthKeyFromDate(new Date()))
  const [todayKey] = useState(() => dateKeyFromDate(new Date()))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [detailExpanded, setDetailExpanded] = useState(false)
  const [typeFilter, setTypeFilter] = useState<EventTypeFilter>('all')

  const resetSelection = useCallback(() => {
    setSelectedDate(null)
    setDetailExpanded(false)
  }, [])

  const closeEventDetail = resetSelection

  const openDateDetail = useCallback((dateKey: string) => {
    setSelectedDate(dateKey)
    setDetailExpanded(window.matchMedia('(min-width: 981px)').matches)
  }, [])

  const moveMonth = useCallback((delta: number) => {
    setVisibleMonth((month) => addMonths(month, delta))
    resetSelection()
  }, [resetSelection])

  return {
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
  }
}
