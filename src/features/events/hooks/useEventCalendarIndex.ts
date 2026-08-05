import { useCallback, useEffect, useState } from 'react'
import { fetchEventCalendarIndex } from '../../data/fetchEventManifest'
import type { EventCalendarIndex, LoadResult } from '../../data/types'

type CalendarIndexResult = LoadResult<EventCalendarIndex> & { url: string }

export function useEventCalendarIndex(rootManifestUrl: string) {
  const [data, setData] = useState<CalendarIndexResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setIsLoading(true)
      }
    })
    fetchEventCalendarIndex(rootManifestUrl, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setData(result)
        setError(null)
      }
    }).catch((loadError: unknown) => {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Event calendar index load failed.')
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        setIsLoading(false)
      }
    })
    return () => controller.abort()
  }, [attempt, rootManifestUrl])

  return { data, error, isLoading, retry }
}
