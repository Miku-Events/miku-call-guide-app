import { loadCache, saveCache } from './cacheStore'
import type {
  CallGuideManifest,
  EventCalendarIndex,
  EventCalendarMonth,
  EventGuide,
  LoadResult,
  RootManifest,
} from './types'

interface ResolvedLoadResult<T> extends LoadResult<T> {
  url: string
}

type AssertFn<T> = (value: unknown) => asserts value is T

export function resolveDataUrl(baseUrl: string, relativePath: string): string {
  return new URL(relativePath, baseUrl).toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertRootManifest(value: unknown): asserts value is RootManifest {
  if (!isRecord(value)) {
    throw new Error('Root manifest response was not an object.')
  }

  const manifest = value as Partial<RootManifest>
  if (
    manifest.schemaVersion !== 1 ||
    !isRecord(manifest.manifests) ||
    typeof manifest.manifests.callGuide !== 'string' ||
    typeof manifest.manifests.eventCalendar !== 'string'
  ) {
    throw new Error('Root manifest schemaVersion or child manifest paths were invalid.')
  }
}

function assertCallGuideManifest(value: unknown): asserts value is CallGuideManifest {
  if (!isRecord(value)) {
    throw new Error('Call guide manifest response was not an object.')
  }

  const manifest = value as Partial<CallGuideManifest>
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.songs)) {
    throw new Error('Call guide manifest schemaVersion or songs were invalid.')
  }
}

function assertEventCalendarIndex(value: unknown): asserts value is EventCalendarIndex {
  if (!isRecord(value)) {
    throw new Error('Event calendar index response was not an object.')
  }

  const index = value as Partial<EventCalendarIndex>
  if (
    index.schemaVersion !== 1 ||
    !Array.isArray(index.availableMonths) ||
    !Array.isArray(index.types) ||
    (index.typePriority !== undefined && !Array.isArray(index.typePriority))
  ) {
    throw new Error('Event calendar index schemaVersion, availableMonths, or types were invalid.')
  }
}

function assertEventCalendarMonth(value: unknown): asserts value is EventCalendarMonth {
  if (!isRecord(value)) {
    throw new Error('Event calendar month response was not an object.')
  }

  const month = value as Partial<EventCalendarMonth>
  if (month.schemaVersion !== 1 || typeof month.month !== 'string' || !Array.isArray(month.events)) {
    throw new Error('Event calendar month schemaVersion, month, or events were invalid.')
  }
}

function assertEventGuide(value: unknown): asserts value is EventGuide {
  if (!isRecord(value)) {
    throw new Error('Event detail response was not an object.')
  }

  const event = value as Partial<EventGuide>
  if (event.schemaVersion !== 1 || typeof event.id !== 'string' || !Array.isArray(event.occurrences) || !isRecord(event.links)) {
    throw new Error('Event detail schemaVersion, id, occurrences, or links were invalid.')
  }
}

async function fetchJsonWithCache<T>(
  url: string,
  cacheKey: string,
  assertValue: AssertFn<T>,
  fallbackWarning: (savedAt: string) => string,
): Promise<LoadResult<T>> {
  try {
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}.`)
    }

    const data = await response.json()
    assertValue(data)
    saveCache(cacheKey, data)
    return { data, source: 'network' }
  } catch (error) {
    const cached = loadCache<unknown>(cacheKey)
    if (cached) {
      assertValue(cached.value)
      return {
        data: cached.value,
        source: 'cache',
        warning: fallbackWarning(cached.savedAt),
      }
    }

    throw error
  }
}

function mergeWarning(...warnings: Array<string | undefined>): string | undefined {
  return warnings.filter(Boolean).join(' ') || undefined
}

export async function fetchRootManifest(rootManifestUrl: string): Promise<ResolvedLoadResult<RootManifest>> {
  if (!rootManifestUrl) {
    throw new Error('VITE_DATA_MANIFEST_URL is not configured.')
  }

  const result = await fetchJsonWithCache(
    rootManifestUrl,
    'manifest:root:v1',
    assertRootManifest,
    (savedAt) => `최신 root manifest를 불러오지 못해 ${savedAt} 캐시를 사용 중입니다.`,
  )
  return { ...result, url: rootManifestUrl }
}

export async function fetchCallGuideManifest(rootManifestUrl: string): Promise<ResolvedLoadResult<CallGuideManifest>> {
  const root = await fetchRootManifest(rootManifestUrl)
  const callGuideUrl = resolveDataUrl(root.url, root.data.manifests.callGuide)
  const result = await fetchJsonWithCache(
    callGuideUrl,
    'manifest:call-guide:v1',
    assertCallGuideManifest,
    (savedAt) => `최신 콜가이드 manifest를 불러오지 못해 ${savedAt} 캐시를 사용 중입니다.`,
  )

  return { ...result, url: callGuideUrl, warning: mergeWarning(root.warning, result.warning) }
}

export async function fetchEventCalendarIndex(rootManifestUrl: string): Promise<ResolvedLoadResult<EventCalendarIndex>> {
  const root = await fetchRootManifest(rootManifestUrl)
  const eventCalendarUrl = resolveDataUrl(root.url, root.data.manifests.eventCalendar)
  const result = await fetchJsonWithCache(
    eventCalendarUrl,
    'event-calendar:index:v1',
    assertEventCalendarIndex,
    (savedAt) => `최신 이벤트 캘린더 index를 불러오지 못해 ${savedAt} 캐시를 사용 중입니다.`,
  )

  return { ...result, url: eventCalendarUrl, warning: mergeWarning(root.warning, result.warning) }
}

export async function fetchEventCalendarMonth(
  eventCalendarIndexUrl: string,
  month: string,
): Promise<ResolvedLoadResult<EventCalendarMonth>> {
  const monthUrl = resolveDataUrl(eventCalendarIndexUrl, `months/${month}.json`)
  const result = await fetchJsonWithCache(
    monthUrl,
    `event-calendar:month:${month}:v1`,
    assertEventCalendarMonth,
    (savedAt) => `최신 ${month} 이벤트 캘린더를 불러오지 못해 ${savedAt} 캐시를 사용 중입니다.`,
  )

  return { ...result, url: monthUrl }
}

export async function fetchEventDetail(
  monthManifestUrl: string,
  eventPath: string,
  eventId: string,
): Promise<ResolvedLoadResult<EventGuide>> {
  const eventUrl = resolveDataUrl(monthManifestUrl, eventPath)
  const result = await fetchJsonWithCache(
    eventUrl,
    `event-detail:${eventId}:v1`,
    assertEventGuide,
    (savedAt) => `최신 이벤트 상세를 불러오지 못해 ${savedAt} 캐시를 사용 중입니다.`,
  )

  return { ...result, url: eventUrl }
}

export const fetchManifest = fetchCallGuideManifest
