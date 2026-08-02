import { useEffect, useMemo, useState } from 'react'
import { resourceCacheKey } from '../../data/cacheStore'
import { fetchEventDetail } from '../../data/fetchEventManifest'
import type {
  CalendarEventSummary,
  EventCalendarMonth,
  EventGuide,
  LoadResult,
} from '../../data/types'

type EventMonthResult = (LoadResult<EventCalendarMonth> & { url: string }) | null

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

      const loaded = await Promise.all(
        missing.map(async (event) => [
          detailKey(monthResult.url, dataVersion, event.path, event.id),
          await fetchEventDetail(monthResult.url, event.path, event.id, {
            expectedDataVersion: dataVersion,
            signal: controller.signal,
          }),
        ] as const),
      )

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
      controller.abort()
    }
  }, [cachedDetails, monthResult, selectedEvents])

  return { details, error, isLoading }
}
