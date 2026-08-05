import { AlertTriangle, CalendarDays, ListMusic, RefreshCw, Search, FolderOpen, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './catalog.css'
import { getRootManifestUrl } from '../../app/config'
import { localizedText } from '../../shared/i18n/localizedText'
import { AppPageShell, StatusBanner } from '../../shared/layout/AppPageShell'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Button } from '@astryxdesign/core/Button'
import { Banner } from '@astryxdesign/core/Banner'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { loadCallGuideManifest, prefetchCallGuideSong } from '../data/callGuideSession'
import type { CallGuideManifest, LoadResult } from '../data/types'
import { loadCallGuideRoute } from '../callGuide/loadCallGuideRoute'
import {
  buildCatalogSnapshot,
  fallbackEventTitle,
  filterCatalogSongs,
  type CatalogSnapshot,
} from './catalogModel'
import { SongCard } from './SongCard'
import { useCatalogThumbnailObserver } from './useCatalogThumbnailObserver'
import { CatalogCardGridSkeleton } from './CatalogCardGridSkeleton'

const PREFETCH_KEY_LIMIT = 5

export function CatalogPage() {
  const [manifestResult, setManifestResult] = useState<LoadResult<CallGuideManifest> | null>(null)
  const [catalogSnapshot, setCatalogSnapshot] = useState<CatalogSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'songs' | 'events'>('songs')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const catalogSnapshotRef = useRef<CatalogSnapshot | null>(null)
  const hoverPrefetchTimerRef = useRef<number | null>(null)
  const prefetchedSongKeysRef = useRef(new Map<string, Promise<void>>())
  const retryAttemptRef = useRef(0)
  const retryControllerRef = useRef<AbortController | null>(null)
  const rootManifestUrl = getRootManifestUrl()
  const {
    loadedSongIds,
    observeThumbnail,
    resetThumbnailVersion,
  } = useCatalogThumbnailObserver()

  const acceptManifest = useCallback((result: LoadResult<CallGuideManifest>) => {
    if (catalogSnapshotRef.current?.dataVersion !== result.data.dataVersion) {
      const nextSnapshot = buildCatalogSnapshot(result.data)
      resetThumbnailVersion(result.data.dataVersion)
      catalogSnapshotRef.current = nextSnapshot
      prefetchedSongKeysRef.current.clear()
      setCatalogSnapshot(nextSnapshot)
    }
    setManifestResult(result)
    setError(null)
  }, [resetThumbnailVersion])

  const retryManifest = useCallback(async () => {
    retryControllerRef.current?.abort()
    const controller = new AbortController()
    const attempt = retryAttemptRef.current + 1
    retryAttemptRef.current = attempt
    retryControllerRef.current = controller
    setIsRetrying(true)

    try {
      const result = await loadCallGuideManifest(rootManifestUrl, {
        force: true,
        signal: controller.signal,
      })
      if (!controller.signal.aborted && retryAttemptRef.current === attempt) {
        acceptManifest(result)
      }
    } catch (loadError) {
      if (!controller.signal.aborted && retryAttemptRef.current === attempt) {
        if (!catalogSnapshotRef.current) {
          setError(loadError instanceof Error ? loadError.message : 'Manifest load failed.')
        }
      }
    } finally {
      if (retryAttemptRef.current === attempt) {
        retryControllerRef.current = null
        setIsRetrying(false)
      }
    }
  }, [acceptManifest, rootManifestUrl])

  useEffect(() => () => {
    retryAttemptRef.current += 1
    retryControllerRef.current?.abort()
    retryControllerRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function loadInitialManifest() {
      try {
        const result = await loadCallGuideManifest(rootManifestUrl, { signal: controller.signal })
        if (!cancelled) {
          acceptManifest(result)
        }
      } catch (loadError) {
        if (controller.signal.aborted) {
          return
        }
        if (!cancelled) {
          setManifestResult(null)
          setError(loadError instanceof Error ? loadError.message : 'Manifest load failed.')
        }
      }
    }

    void loadInitialManifest()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [acceptManifest, rootManifestUrl])

  const prefetchPractice = useCallback((songId: string): Promise<void> => {
    const dataVersion = catalogSnapshotRef.current?.dataVersion
    if (!dataVersion) {
      return Promise.resolve()
    }

    const key = `${dataVersion}\0${songId}`
    const prefetchedSongs = prefetchedSongKeysRef.current
    const existing = prefetchedSongs.get(key)
    if (existing) {
      prefetchedSongs.delete(key)
      prefetchedSongs.set(key, existing)
      return existing
    }

    const request = Promise.all([
      loadCallGuideRoute(),
      prefetchCallGuideSong(rootManifestUrl, songId),
    ])
      .then(() => undefined)
    const trackedRequest = request
      .catch((prefetchError: unknown) => {
        if (prefetchedSongs.get(key) === trackedRequest) {
          prefetchedSongs.delete(key)
        }
        throw prefetchError
      })
    prefetchedSongs.set(key, trackedRequest)
    while (prefetchedSongs.size > PREFETCH_KEY_LIMIT) {
      const oldestKey = prefetchedSongs.keys().next().value
      if (oldestKey === undefined) {
        break
      }
      prefetchedSongs.delete(oldestKey)
    }
    return trackedRequest
  }, [rootManifestUrl])

  const cancelHoverPrefetch = useCallback(() => {
    if (hoverPrefetchTimerRef.current !== null) {
      window.clearTimeout(hoverPrefetchTimerRef.current)
      hoverPrefetchTimerRef.current = null
    }
  }, [])

  const scheduleHoverPrefetch = useCallback((songId: string) => {
    cancelHoverPrefetch()
    hoverPrefetchTimerRef.current = window.setTimeout(() => {
      hoverPrefetchTimerRef.current = null
      void prefetchPractice(songId).catch(() => undefined)
    }, 100)
  }, [cancelHoverPrefetch, prefetchPractice])

  const prefetchPracticeImmediately = useCallback((songId: string) => {
    cancelHoverPrefetch()
    void prefetchPractice(songId).catch(() => undefined)
  }, [cancelHoverPrefetch, prefetchPractice])

  useEffect(() => cancelHoverPrefetch, [cancelHoverPrefetch])

  useEffect(() => {
    document.title = '곡 카탈로그 - 하츠네 미쿠 콜 가이드'
  }, [])

  useEffect(() => {
    const main = document.querySelector('.catalog-shell .app-main')
    if (!main) return

    let wasScrolled: boolean | null = null
    const updateScrollState = () => {
      const isScrolled = main.scrollTop > 0
      if (isScrolled !== wasScrolled) {
        wasScrolled = isScrolled
        main.setAttribute('data-scrolled', isScrolled ? 'true' : 'false')
      }
    }
    updateScrollState()
    main.addEventListener('scroll', updateScrollState, { passive: true })

    return () => {
      main.removeEventListener('scroll', updateScrollState)
    }
  }, [])

  const eventFolders = catalogSnapshot?.eventFolders ?? []
  const manifestDataVersion = manifestResult?.data.dataVersion

  const filteredSongs = useMemo(() => {
    if (!catalogSnapshot || catalogSnapshot.dataVersion !== manifestDataVersion) {
      return []
    }

    return filterCatalogSongs(catalogSnapshot.songs, query, selectedTag)
  }, [catalogSnapshot, manifestDataVersion, query, selectedTag])

  const songCount = manifestResult?.data.songs.length ?? 0
  const resultCount = filteredSongs.length
  const prioritySongId = catalogSnapshot?.songs[0]?.song.id

  return (
    <AppPageShell
      activeNav="catalog"
      className="catalog-shell"
      kicker="Call Guide Library"
      summaryItems={[
        { icon: <ListMusic size={14} aria-hidden="true" />, label: 'Songs', value: songCount },
        { label: 'Shown', value: resultCount },
      ]}
      title="콜 가이드"
      toolbar={
        <div className="flex items-center gap-4 w-full flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <TextInput
              label="곡 검색"
              className="catalog-search"
              isLabelHidden
              value={query}
              onChange={(val) => setQuery(val)}
              placeholder="Search title, artist, call summary, tag"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              startIcon={Search as any}
              hasClear
            />
          </div>
          <div className="flex items-center bg-[var(--color-background-raised)] border border-[var(--color-border-subtle)] p-0.5 rounded-[var(--radius-element)]" aria-label="Catalog view">
            <button
              type="button"
              data-active={viewMode === 'songs' ? 'true' : 'false'}
              onClick={() => setViewMode('songs')}
              className={`flex min-h-[var(--app-touch-target)] items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-inner)] transition-all ${
                viewMode === 'songs'
                  ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary-on-blend)] shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
              }`}
            >
              <ListMusic size={16} aria-hidden="true" />
              <span>전체</span>
            </button>
            <button
              type="button"
              data-active={viewMode === 'events' ? 'true' : 'false'}
              onClick={() => setViewMode('events')}
              className={`flex min-h-[var(--app-touch-target)] items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-inner)] transition-all ${
                viewMode === 'events'
                  ? 'bg-[var(--color-background-primary)] text-[var(--color-text-primary-on-blend)] shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background-hover)]'
              }`}
            >
              <CalendarDays size={16} aria-hidden="true" />
              <span>Events</span>
            </button>
          </div>
        </div>
      }
    >
      {manifestResult?.warning ? (
        <StatusBanner
          action={(
            <Button
              isDisabled={isRetrying}
              isLoading={isRetrying}
              label="다시 시도"
              variant="secondary"
              onClick={retryManifest}
              icon={<RefreshCw size={16} aria-hidden="true" />}
            />
          )}
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          variant="warning"
        >
          {manifestResult.warning}
        </StatusBanner>
      ) : null}

      {error ? (
        <StatusBanner
          action={(
            <Button
              isDisabled={isRetrying}
              isLoading={isRetrying}
              label="다시 시도"
              variant="secondary"
              onClick={retryManifest}
              icon={<RefreshCw size={16} aria-hidden="true" />}
            />
          )}
          icon={<AlertTriangle size={18} aria-hidden="true" />}
          role="alert"
          variant="error"
        >
          {error}
        </StatusBanner>
      ) : null}

      {selectedTag && viewMode === 'songs' ? (
        <div className="mb-4">
          <Banner
            status="info"
            container="card"
            title={
              <span>
                이벤트 <strong>{localizedText((manifestResult?.data.eventRegistry ?? {})[selectedTag]?.title ?? fallbackEventTitle(selectedTag), 'ko', ['ja', 'en'])}</strong>의 수록곡을 보고 있습니다.
              </span>
            }
            endContent={
              <Button
                label="필터 해제"
                variant="ghost"
                icon={<X size={16} />}
                onClick={() => {
                  setSelectedTag(null)
                  setViewMode('events')
                }}
              />
            }
          />
        </div>
      ) : null}

      <div aria-busy={isRetrying} className="catalog-content-layout">
        <div className="sr-only" aria-live="polite">
          {query ? `검색 결과가 ${resultCount}개 있습니다.` : `전체 ${songCount}개의 곡이 있습니다.`}
        </div>
        <section className="catalog-content-panel" aria-label="Call guide songs">
          {manifestResult && viewMode === 'events' ? (
            <div className="catalog-event-grid">
              {eventFolders.map((folder) => {
                const folderTitle = localizedText(folder.title, 'ko', ['ja', 'en'])
                return (
                  <button
                    className="catalog-event-folder-card"
                    key={folder.id}
                    onClick={() => {
                      setSelectedTag(folder.id)
                      setViewMode('songs')
                    }}
                    type="button"
                  >
                    <h3>{folderTitle}</h3>
                    <div className="catalog-event-count-badge">
                      <FolderOpen size={14} style={{ marginRight: '0.35rem', display: 'inline-block', verticalAlign: 'middle' }} />
                      <span style={{ verticalAlign: 'middle' }}>{folder.songCount}곡 수록</span>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : manifestResult && viewMode === 'songs' ? (
            <>
              <div className="catalog-song-grid">
                {filteredSongs.map((entry) => {
                  const isPriorityThumbnail = entry.song.id === prioritySongId
                  return (
                    <SongCard
                      entry={entry}
                      isPriorityThumbnail={isPriorityThumbnail}
                      isThumbnailLoaded={loadedSongIds.has(entry.song.id)}
                      key={entry.song.id}
                      observeThumbnail={observeThumbnail}
                      onCancelHoverPrefetch={cancelHoverPrefetch}
                      onImmediatePrefetch={prefetchPracticeImmediately}
                      onScheduleHoverPrefetch={scheduleHoverPrefetch}
                    />
                  )
                })}
              </div>
              {filteredSongs.length === 0 ? (
                <EmptyState
                  title="검색 결과가 없습니다"
                  description={`입력하신 검색어 '${query}'에 일치하는 곡이 없습니다. 다른 검색어를 입력하시거나 필터를 초기화해 보세요.`}
                  icon={<Search size={32} />}
                  actions={
                    <Button
                      label="검색 초기화"
                      variant="secondary"
                      onClick={() => {
                        setQuery('')
                        setSelectedTag(null)
                      }}
                    />
                  }
                />
              ) : null}
            </>
          ) : !error ? (
            <CatalogCardGridSkeleton />
          ) : null}
        </section>
      </div>
    </AppPageShell>
  )
}
