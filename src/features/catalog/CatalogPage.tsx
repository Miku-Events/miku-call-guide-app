import { AlertTriangle, ArrowRight, CalendarDays, ListMusic, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getRootManifestUrl } from '../../app/config'
import { AppPageShell, StatusBanner } from '../../shared/layout/AppPageShell'
import { localizedText } from '../callGuide/callPositioning'
import { fetchCallGuideManifest } from '../data/fetchManifest'
import type { CallGuideManifest, LoadResult, ManifestSong } from '../data/types'

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
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const rootManifestUrl = getRootManifestUrl()

  const load = useCallback(async () => {
    try {
      setManifestResult(await fetchCallGuideManifest(rootManifestUrl))
      setError(null)
    } catch (loadError) {
      setManifestResult(null)
      setError(loadError instanceof Error ? loadError.message : 'Manifest load failed.')
    }
  }, [rootManifestUrl])

  useEffect(() => {
    let cancelled = false

    async function loadInitialManifest() {
      try {
        const result = await fetchCallGuideManifest(rootManifestUrl)
        if (!cancelled) {
          setManifestResult(result)
          setError(null)
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
  }, [rootManifestUrl])

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

  const filteredSongs = useMemo(() => {
    if (!manifestResult) {
      return []
    }

    return manifestResult.data.songs.filter((song) => songMatches(song, query))
  }, [manifestResult, query])

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
        <>
          <label className="catalog-search">
            <Search size={18} aria-hidden="true" />
            <input
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search title, artist, call summary, tag"
              type="search"
              value={query}
              aria-label="곡 검색"
            />
          </label>
          <div className="catalog-segmented" aria-label="Catalog view">
            <button className="catalog-segment-button" data-active="true" aria-pressed="true" type="button">
              <ListMusic size={16} aria-hidden="true" />
              전체
            </button>
            <Link className="catalog-segment-button" data-active="false" aria-pressed="false" to="/events">
              <CalendarDays size={16} aria-hidden="true" />
              Events
            </Link>
          </div>
        </>
      }
    >
      {manifestResult?.warning ? (
        <StatusBanner
          action={(
            <button className="catalog-retry-button" onClick={load} type="button">
              <RefreshCw size={16} aria-hidden="true" />
              다시 시도
            </button>
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
            <button className="catalog-retry-button" onClick={load} type="button">
              <RefreshCw size={16} aria-hidden="true" />
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

      <div className="catalog-content-layout">
        <div className="sr-only" aria-live="polite">
          {query ? `검색 결과가 ${resultCount}개 있습니다.` : `전체 ${songCount}개의 곡이 있습니다.`}
        </div>
        <section className="catalog-content-panel" aria-label="Call guide songs">
          {manifestResult ? (
            <div className="catalog-song-grid">
              {filteredSongs.map((song) => {
                const callSummary = localizedText(song.callSummary, 'ko', ['ja', 'en'])
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
                      {callSummary ? <p className="catalog-call-summary">{callSummary}</p> : null}
                      <div className="catalog-card-action">
                        <span>Practice</span>
                        <ArrowRight size={16} aria-hidden="true" />
                      </div>
                    </div>
                  </Link>
                )
              })}
               {filteredSongs.length === 0 ? (
                <div className="catalog-empty-state">
                  <div className="catalog-empty-icon" aria-hidden="true">
                    <Search size={32} />
                  </div>
                  <h3>검색 결과가 없습니다</h3>
                  <p>입력하신 검색어 '{query}'에 일치하는 곡이 없습니다. 다른 검색어를 입력하시거나 필터를 초기화해 보세요.</p>
                  <button
                    className="app-secondary-button"
                    onClick={() => setQuery('')}
                    type="button"
                  >
                    검색 초기화
                  </button>
                </div>
              ) : null}
            </div>
          ) : !error ? (
            <div className="catalog-song-grid">
              {Array.from({ length: 6 }).map((_, index) => (
                <div className="catalog-song-card catalog-song-card--skeleton" key={index} aria-hidden="true">
                  <div className="catalog-song-media skeleton" style={{ minHeight: '10.25rem' }} />
                  <div className="catalog-song-content" style={{ marginTop: '0', background: 'transparent', paddingTop: '1rem' }}>
                    <div className="skeleton" style={{ height: '1.4rem', width: '70%', marginBottom: '0.6rem' }} />
                    <div className="skeleton" style={{ height: '0.9rem', width: '40%', marginBottom: '1.2rem' }} />
                    <div className="skeleton" style={{ height: '2.5rem', width: '100%', marginBottom: '1rem' }} />
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
