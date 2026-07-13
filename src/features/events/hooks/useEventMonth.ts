import { useEffect, useState } from 'react'
import { fetchEventCalendarMonth } from '../../data/fetchManifest'
import type { EventCalendarMonth, LoadResult } from '../../data/types'

interface MonthLoadResult extends LoadResult<EventCalendarMonth> {
  url: string
}

interface LoadedMonth {
  identity: string
  result: MonthLoadResult
}

function makeEmptyMonth(month: string, indexUrl: string, dataVersion: string): MonthLoadResult {
  return {
    data: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      dataVersion,
      month,
      events: [],
    },
    source: 'network',
    url: new URL(`months/${month}.json`, indexUrl).toString(),
  }
}

export function useEventMonth(
  calendarIndex: { url: string; data: { availableMonths: string[]; dataVersion: string } } | null,
  visibleMonth: string,
  onReset: () => void
) {
  const [loadedMonth, setLoadedMonth] = useState<LoadedMonth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const loadIdentity = calendarIndex
    ? JSON.stringify([calendarIndex.url, calendarIndex.data.dataVersion, visibleMonth])
    : null

  useEffect(() => {
    if (!calendarIndex) {
      return
    }
    const identity = JSON.stringify([calendarIndex.url, calendarIndex.data.dataVersion, visibleMonth])

    const controller = new AbortController()
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setIsLoading(true)
      }
    })

    const availableMonths = calendarIndex.data.availableMonths
    const dataVersion = calendarIndex.data.dataVersion
    const indexUrl = calendarIndex.url

    async function execute() {
      try {
        const isAvailable = availableMonths.includes(visibleMonth)
        let result: MonthLoadResult

        if (isAvailable) {
          result = await fetchEventCalendarMonth(indexUrl, visibleMonth, {
            expectedDataVersion: dataVersion,
            signal: controller.signal,
          })
        } else {
          result = makeEmptyMonth(visibleMonth, indexUrl, dataVersion)
        }

        if (!controller.signal.aborted) {
          setLoadedMonth({ identity, result })
          onReset()
          setError(null)
        }
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return
        if (!controller.signal.aborted) {
          setLoadedMonth(null)
          setError(err instanceof Error ? err.message : 'Event calendar month load failed.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    void execute()

    return () => {
      controller.abort()
    }
  }, [calendarIndex, visibleMonth, onReset, loadIdentity])

  return {
    data: loadedMonth?.identity === loadIdentity ? loadedMonth.result : null,
    error,
    isLoading
  }
}
