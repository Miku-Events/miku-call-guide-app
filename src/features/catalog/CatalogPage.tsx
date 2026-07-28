import { AlertTriangle, CalendarDays, ListMusic, RefreshCw, Search, FolderOpen, X, ArrowRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import './catalog.css'
import { getRootManifestUrl } from '../../app/config'
import { localizedText } from '../../shared/i18n/localizedText'
import { AppPageShell, StatusBanner } from '../../shared/layout/AppPageShell'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Button } from '@astryxdesign/core/Button'
import { Banner } from '@astryxdesign/core/Banner'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { fetchCallGuideManifest } from '../data/fetchManifest'
import type { CallGuideManifest, LoadResult, ManifestSong, LocalizedText } from '../data/types'
import { shuffledCopy } from './shuffle'

const BLACKLIST_TAGS: string[] = []

interface EventFolder {
  id: string;
  title: LocalizedText;
  songCount: number;
  songs: ManifestSong[];
}

interface ShuffledCatalog {
  dataVersion: string
  songs: ManifestSong[]
}

function formatFallbackEventTitle(tag: string): string {
  return tag
    .split('-')
    .map(word => {
      if (word === 'miku') return 'Miku'
      if (word === 'expo') return 'EXPO'
      if (word === 'vr') return 'VR'
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function songMatches(song: ManifestSong, query: string): boolean {
  const haystack = [
    ...Object.values(song.title),
    ...Object.values(song.artist),
    ...Object.values(song.callSummary ?? {}),
    song.youtubeVideoId,
    ...song.tags,
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(query.toLowerCase())
}

function youtubeThumbnailUrl(song: ManifestSong): string {
  return `https://i.ytimg.com/vi/${song.originalSongId ?? song.youtubeVideoId}/hqdefault.jpg`
}

export function CatalogPage() {
  const [manifestResult, setManifestResult] = useState<LoadResult<CallGuideManifest> | null>(null)
  const [shuffledCatalog, setShuffledCatalog] = useState<ShuffledCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'songs' | 'events'>('songs')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const rootManifestUrl = getRootManifestUrl()

  const acceptManifest = useCallback((result: LoadResult<CallGuideManifest>) => {
    setManifestResult(result)
    setShuffledCatalog((current) => {
      if (current?.dataVersion === result.data.dataVersion) {
        return current
      }

      return {
        dataVersion: result.data.dataVersion,
        songs: shuffledCopy(result.data.songs),
      }
    })
    setError(null)
  }, [])

  const load = useCallback(async () => {
    try {
      acceptManifest(await fetchCallGuideManifest(rootManifestUrl))
    } catch (loadError) {
      setManifestResult(null)
      setError(loadError instanceof Error ? loadError.message : 'Manifest load failed.')
    }
  }, [acceptManifest, rootManifestUrl])

  useEffect(() => {
    let cancelled = false

    async function loadInitialManifest() {
      try {
        const result = await fetchCallGuideManifest(rootManifestUrl)
        if (!cancelled) {
          acceptManifest(result)
        }
      } catch (loadError) {
        if (!cancelled) {
          setManifestResult(null)
          setError(loadError instanceof Error ? loadError.message : 'Manifest load failed.')
        }
      }
    }

    void loadInitialManifest()

    return () => {
      cancelled = true
    }
  }, [acceptManifest, rootManifestUrl])

  useEffect(() => {
    document.title = '곡 카탈로그 - 하츠네 미쿠 콜 가이드'
  }, [])

  useEffect(() => {
    const main = document.querySelector('.catalog-shell .app-main')
    if (!main) return

    const sentinel = document.createElement('div')
    sentinel.style.cssText = 'height:1px;pointer-events:none;'
    main.prepend(sentinel)

    const observer = new IntersectionObserver(
      ([entry]) => {
        main.setAttribute('data-scrolled', entry.isIntersecting ? 'false' : 'true')
      },
      { root: main, threshold: 0 }
    )
    observer.observe(sentinel)

    return () => {
      observer.disconnect()
      sentinel.remove()
    }
  }, [])

  const eventFolders = useMemo<EventFolder[]>(() => {
    if (!manifestResult) return []

    const tagCounts: Record<string, { tag: string; songs: ManifestSong[] }> = {}

    manifestResult.data.songs.forEach(song => {
      song.tags.forEach(tag => {
        if (BLACKLIST_TAGS.includes(tag)) return

        if (!tagCounts[tag]) {
          tagCounts[tag] = { tag, songs: [] }
        }
        tagCounts[tag].songs.push(song)
      })
    })

    const eventRegistry = manifestResult.data.eventRegistry ?? {}

    return Object.entries(tagCounts)
      .filter(([, folder]) => folder.songs.length >= 2)
      .map(([tag, folder]) => {
        const registryEntry = eventRegistry[tag]
        const title = registryEntry
          ? registryEntry.title
          : { ko: formatFallbackEventTitle(tag), en: formatFallbackEventTitle(tag), ja: formatFallbackEventTitle(tag) }
        return {
          id: tag,
          title,
          songCount: folder.songs.length,
          songs: folder.songs,
        }
      })
      .sort((a, b) => b.songCount - a.songCount)
  }, [manifestResult])

  const filteredSongs = useMemo(() => {
    if (!manifestResult || shuffledCatalog?.dataVersion !== manifestResult.data.dataVersion) {
      return []
    }

    let list = shuffledCatalog.songs
    if (selectedTag) {
      list = list.filter((song) => song.tags.includes(selectedTag))
    }

    return list.filter((song) => songMatches(song, query))
  }, [manifestResult, query, selectedTag, shuffledCatalog])

  const songCount = manifestResult?.data.songs.length ?? 0
  const resultCount = filteredSongs.length

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
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-inner)] transition-all ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-inner)] transition-all ${
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
              label="다시 시도"
              variant="secondary"
              onClick={load}
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
              label="다시 시도"
              variant="secondary"
              onClick={load}
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
                이벤트 <strong>{localizedText((manifestResult?.data.eventRegistry ?? {})[selectedTag]?.title ?? { ko: formatFallbackEventTitle(selectedTag), en: formatFallbackEventTitle(selectedTag), ja: formatFallbackEventTitle(selectedTag) }, 'ko', ['ja', 'en'])}</strong>의 수록곡을 보고 있습니다.
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

      <div className="catalog-content-layout">
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
                {filteredSongs.map((song) => {
                  const usesOriginalArtwork = Boolean(song.originalSongId)

                  return (
                    <Link
                      className={`catalog-song-card${usesOriginalArtwork ? ' catalog-song-card--original-art' : ''}`}
                      key={song.id}
                      to={`/songs/${song.id}`}
                    >
                      <div className="catalog-song-media" aria-hidden="true">
                        <div className="catalog-song-fallback-bg" />
                        <img
                          alt=""
                          aria-hidden="true"
                          className="catalog-song-thumbnail"
                          loading="lazy"
                          src={youtubeThumbnailUrl(song)}
                          onError={(event) => {
                            event.currentTarget.style.display = 'none'
                          }}
                        />
                      </div>
                      <div className="catalog-song-content">
                        <h2>{localizedText(song.title, 'ko', ['ja', 'en'])}</h2>
                        <p>{localizedText(song.artist, 'ko', ['ja', 'en'])}</p>
                        <div className="catalog-card-action">
                          <span>Practice</span>
                          <ArrowRight size={16} aria-hidden="true" />
                        </div>
                      </div>
                    </Link>
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
            <div className="catalog-song-grid">
              {Array.from({ length: 6 }).map((_, index) => (
                <div className="catalog-song-card catalog-song-card--skeleton" key={index} aria-hidden="true">
                  <div className="catalog-song-media skeleton" style={{ minHeight: '8rem' }} />
                  <div className="catalog-song-content" style={{ marginTop: '0', background: 'transparent', paddingTop: '1rem' }}>
                    <div className="skeleton" style={{ height: '1.4rem', width: '70%', marginBottom: '0.6rem' }} />
                    <div className="skeleton" style={{ height: '0.9rem', width: '40%', marginBottom: '1.2rem' }} />
                    <div className="catalog-card-action" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem', marginTop: 'auto' }}>
                      <div className="skeleton" style={{ height: '1rem', width: '25%' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </AppPageShell>
  )
}
