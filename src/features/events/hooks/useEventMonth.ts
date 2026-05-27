import { useEffect, useState } from 'react'
import type { EventCalendarMonth, LoadResult } from '../../data/types'

interface MonthLoadResult extends LoadResult<EventCalendarMonth> {
  url: string
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

export function useEventMonth(
  calendarIndex: { url: string; data: { availableMonths: string[] } } | null,
  visibleMonth: string,
  onReset: () => void
) {
  const [data, setData] = useState<MonthLoadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const index = calendarIndex
    if (!index) {
      setData(null)
      return
    }

    const controller = new AbortController()
    setIsLoading(true)

    const availableMonths = index.data.availableMonths
    const indexUrl = index.url

    async function execute() {
      try {
        const isAvailable = availableMonths.includes(visibleMonth)
        let result: MonthLoadResult

        if (isAvailable) {
          const fetchUrl = new URL(`months/${visibleMonth}.json`, indexUrl).toString()
          const response = await fetch(fetchUrl, {
            signal: controller.signal,
            cache: 'no-cache',
          })
          if (!response.ok) {
            throw new Error(`Event calendar month request failed with ${response.status}.`)
          }
          const payload = await response.json()
          result = { data: payload, source: 'network', url: fetchUrl }
        } else {
          result = makeEmptyMonth(visibleMonth, indexUrl)
        }

        setData(result)
        onReset()
        setError(null)
      } catch (err: any) {
        if (err.name === 'AbortError') return
        setData(null)
        setError(err.message || 'Event calendar month load failed.')
      } finally {
        setIsLoading(false)
      }
    }

    void execute()

    return () => {
      controller.abort()
    }
  }, [calendarIndex, visibleMonth])

  return { data, error, isLoading }
}
