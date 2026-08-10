import { useEffect, useMemo, useState } from 'react'
import { resourceCacheKey } from '../../data/cacheStore'
import { fetchEventDetail } from '../../data/fetchEventManifest'
import {
  CALL_GUIDE_LOAD_DEADLINE_MS,
  DataRequestTimeoutError,
} from '../../data/dataRequestTimeout'
import type {
  CalendarEventSummary,
  EventCalendarMonth,
  EventGuide,
  LoadResult,
} from '../../data/types'

type EventMonthResult = (LoadResult<EventCalendarMonth> & { url: string }) | null
const EVENT_DETAIL_CONCURRENCY = 6

function detailKey(monthManifestUrl: string, dataVersion: string, eventPath: string, eventId: string): string {
  return `${resourceCacheKey(monthManifestUrl, dataVersion, eventPath)}:${encodeURIComponent(eventId)}`
}

export function useEventDetails(
  monthResult: EventMonthResult,
  selectedEvents: CalendarEventSummary[],
) {
  const [cachedDetails, setCachedDetails] = useState<Record<string, LoadResult<EventGuide>>>({})
  const [error, setError] = useState<string | null>(null)

  const details = useMemo(() => {
    const currentDetails: Record<string, LoadResult<EventGuide>> = {}
    const dataVersion = monthResult?.data.dataVersion
    if (!dataVersion) {
      return currentDetails
    }

    for (const event of selectedEvents) {
      const detail = cachedDetails[detailKey(monthResult.url, dataVersion, event.path, event.id)]
      if (detail) {
        currentDetails[event.id] = detail
      }
    }

    return currentDetails
  }, [cachedDetails, monthResult, selectedEvents])

  const isLoading = Boolean(
    monthResult
    && selectedEvents.length > 0
    && selectedEvents.some((event) => !details[event.id])
    && !error,
  )

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    let deadline: ReturnType<typeof globalThis.setTimeout> | undefined

    async function loadDetails() {
      setError(null)
      if (!monthResult || selectedEvents.length === 0) {
        return
      }

      const dataVersion = monthResult.data.dataVersion
      const missing = selectedEvents.filter(
        (event) => !cachedDetails[detailKey(monthResult.url, dataVersion, event.path, event.id)],
      )
      if (missing.length === 0) {
        return
      }

      deadline = globalThis.setTimeout(() => {
        if (!controller.signal.aborted) {
          controller.abort(new DataRequestTimeoutError('resource'))
        }
      }, CALL_GUIDE_LOAD_DEADLINE_MS)

      const loaded = new Array<readonly [string, LoadResult<EventGuide>]>(missing.length)
      let nextIndex = 0
      const worker = async () => {
        while (nextIndex < missing.length) {
          const index = nextIndex
          nextIndex += 1
          const event = missing[index]
          loaded[index] = [
            detailKey(monthResult.url, dataVersion, event.path, event.id),
            await fetchEventDetail(monthResult.url, event.path, event.id, {
              expectedDataVersion: dataVersion,
              signal: controller.signal,
            }),
          ] as const
        }
      }
      try {
        await Promise.all(
          Array.from({ length: Math.min(EVENT_DETAIL_CONCURRENCY, missing.length) }, worker),
        )
      } catch (loadError) {
        if (!controller.signal.aborted) controller.abort(loadError)
        throw loadError
      } finally {
        if (deadline !== undefined) {
          globalThis.clearTimeout(deadline)
          deadline = undefined
        }
      }

      if (!cancelled) {
        setCachedDetails((current) => ({ ...current, ...Object.fromEntries(loaded) }))
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
      if (deadline !== undefined) globalThis.clearTimeout(deadline)
      controller.abort()
    }
  }, [cachedDetails, monthResult, selectedEvents])

  return { details, error, isLoading }
}
