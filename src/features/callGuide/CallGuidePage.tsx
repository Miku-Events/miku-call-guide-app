import { AlertTriangle, ArrowLeft, CalendarDays, Circle, ListMusic } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getRootManifestUrl, shouldUseMockPlayer } from '../../app/config'
import { formatMs } from '../../shared/time/formatTime'
import { fetchCallGuideManifest } from '../data/fetchManifest'
import { fetchSong } from '../data/fetchSong'
import type { CallGuideManifest, LoadResult, LyricLine, SongGuide } from '../data/types'
import { YouTubePlayer, type YouTubePlayerHandle } from '../player/YouTubePlayer'
import {
  activeGlobalCalls,
  callKindLegend,
  callKindsInSong,
  findActiveLyric,
  localizedText,
  normalizedCallKind,
} from './callPositioning'
import { LyricList } from './LyricList'

export function CallGuidePage() {
  const { songId } = useParams()
  const [manifestResult, setManifestResult] = useState<LoadResult<CallGuideManifest> | null>(null)
  const [songResult, setSongResult] = useState<LoadResult<SongGuide> | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [seekRequest, setSeekRequest] = useState<{ id: number; timeMs: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const playerRef = useRef<YouTubePlayerHandle | null>(null)
  const seekRequestIdRef = useRef(0)
  const rootManifestUrl = getRootManifestUrl()
  const mockPlayer = shouldUseMockPlayer()

  useEffect(() => {
    let cancelled = false

    async function loadInitialSong() {
      if (!songId) {
        setError('Song id was missing.')
        return
      }

      try {
        const loadedManifest = await fetchCallGuideManifest(rootManifestUrl)
        const manifestSong = loadedManifest.data.songs.find((song) => song.id === songId)
        if (!manifestSong) {
          throw new Error(`Song "${songId}" was not found in manifest.`)
        }

        const loadedSong = await fetchSong(loadedManifest.url, manifestSong.path, songId)

        if (!cancelled) {
          setManifestResult(loadedManifest)
          setSongResult(loadedSong)
          setError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Song load failed.')
        }
      }
    }

    void loadInitialSong()

    return () => {
      cancelled = true
    }
  }, [rootManifestUrl, songId])

  const song = songResult?.data

  useEffect(() => {
    if (song) {
      const title = localizedText(song.metadata.title, 'ko', ['ja', 'en'])
      const artist = localizedText(song.metadata.artist, 'ko', ['ja', 'en'])
      document.title = `${title} (${artist}) - 콜 가이드 - 하츠네 미쿠 콜 가이드`
    } else {
      document.title = '곡 상세 - 하츠네 미쿠 콜 가이드'
    }
  }, [song])

  const activeLine = useMemo(() => (song ? findActiveLyric(song.lyrics, currentMs) : null), [currentMs, song])
  const globalCalls = useMemo(() => (song ? activeGlobalCalls(song.callEvents, currentMs) : []), [currentMs, song])
  const callLegendKinds = useMemo(() => (song ? callKindsInSong(song.callEvents) : []), [song])
  const seekToLine = (line: LyricLine) => {
    seekRequestIdRef.current += 1
    setCurrentMs(line.startMs)
    setSeekRequest({ id: seekRequestIdRef.current, timeMs: line.startMs })
    playerRef.current?.seekTo(line.startMs)
  }

  return (
    <main className="app-shell player-shell">
      <header className="top-bar player-top-bar sticky top-0 z-10">
        <div className="player-top-bar-inner">
          <div className="player-brand-group">
            <Link className="player-brand-link" to="/">
              <ArrowLeft size={17} aria-hidden="true" />
              Miku Call Guide
            </Link>
            <nav className="player-nav" aria-label="Player navigation">
              <Link className="player-nav-link" to="/">
                <ListMusic size={18} aria-hidden="true" />
                Catalog
              </Link>
              <Link className="player-nav-link" to="/events">
                <CalendarDays size={18} aria-hidden="true" />
                Events
              </Link>
              <span className="player-nav-link" data-active="true">
                <Circle size={10} aria-hidden="true" fill="currentColor" />
                Practice
              </span>
            </nav>
          </div>
          <div className="player-status-cluster">
            <span className="player-live-dot" aria-hidden="true" />
            <div className="player-clock">
              <p>{song ? formatMs(currentMs) : '0:00.0'}</p>
              <span>
              {manifestResult?.source === 'cache' || songResult?.source === 'cache' ? 'cached data' : 'live data'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <section className="player-main">
        {manifestResult?.warning || songResult?.warning ? (
          <div className="status-banner flex items-start gap-2">
            <AlertTriangle size={18} aria-hidden="true" />
            <p>{manifestResult?.warning ?? songResult?.warning}</p>
          </div>
        ) : null}

        {error ? (
          <div className="status-banner flex items-start gap-2" role="alert">
            <AlertTriangle size={18} aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : null}

        {song ? (
          <>
            <div className="player-grid">
              <section className="player-video-panel">
                <div className="player-video-stack">
                  <div className="player-title-block">
                    <p>Call Guide Practice</p>
                    <h1>{localizedText(song.metadata.title, 'ko', ['ja', 'en'])}</h1>
                    <span>{localizedText(song.metadata.artist, 'ko', ['ja', 'en'])}</span>
                  </div>
                  <div className="video-frame">
                    <YouTubePlayer
                      durationMs={song.timing.durationMs}
                      mock={mockPlayer}
                      onTimeUpdate={setCurrentMs}
                      ref={playerRef}
                      seekRequest={seekRequest}
                      startOffsetMs={song.youtube.startOffsetMs}
                      videoId={song.youtube.videoId}
                    />
                  </div>
                  <div className="player-active-meta">
                    <ListMusic size={17} aria-hidden="true" />
                    <span>{activeLine ? activeLine.id : 'No active lyric line'}</span>
                  </div>
                </div>
              </section>

              <section className="live-lyrics-panel">
                {callLegendKinds.length > 0 ? (
                  <aside aria-label="콜 타입 안내" className="call-kind-legend">
                    <span className="call-kind-legend-title">Legend</span>
                    <div className="call-kind-legend-items">
                      {callLegendKinds.map((kind) => {
                        const legend = callKindLegend[kind]

                        return (
                          <div className="call-kind-legend-item" data-kind={kind} key={kind}>
                            <span className="call-kind-dot" aria-hidden="true" />
                            <span className="call-kind-copy">
                              <strong>{legend.label}</strong>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </aside>
                ) : null}
                {globalCalls.length > 0 ? (
                  <div className="global-call-banner">
                    {globalCalls.map((call) => (
                      <p
                        className="global-call-item font-black"
                        data-kind={normalizedCallKind(call)}
                        data-intensity={call.cue.intensity}
                        key={call.id}
                      >
                        {localizedText(call.text, song.display.defaultCallLanguage, ['ko', 'ja', 'en'])}
                      </p>
                    ))}
                  </div>
                ) : null}
                <LyricList currentMs={currentMs} onSeekToLine={seekToLine} song={song} />
              </section>
            </div>
          </>
        ) : !error ? (
          <div className="player-grid">
            <section className="player-video-panel">
              <div className="player-video-stack">
                <div className="player-title-block">
                  <div className="skeleton skeleton-text" style={{ width: '30%', height: '0.8rem', marginBottom: '0.4rem' }} />
                  <div className="skeleton skeleton-text" style={{ width: '70%', height: '2rem', marginBottom: '0.4rem' }} />
                  <div className="skeleton skeleton-text" style={{ width: '40%', height: '1rem' }} />
                </div>
                <div className="video-frame skeleton skeleton-video" style={{ background: 'rgba(255, 255, 255, 0.03)' }} />
                <div className="player-active-meta" style={{ display: 'none' }}>
                  <div className="skeleton skeleton-text" style={{ width: '20%', height: '1rem' }} />
                </div>
              </div>
            </section>

            <section className="live-lyrics-panel">
              <div className="call-kind-legend" style={{ height: '2.2rem', border: '0', background: 'rgba(255, 255, 255, 0.03)', marginBottom: '0.65rem', borderRadius: '0.5rem' }} />
              <div className="skeleton-lyric-list">
                <div className="skeleton-lyric-line" style={{ opacity: 0.15 }}><div className="skeleton skeleton-text" style={{ width: '50%', height: '1.4rem' }} /></div>
                <div className="skeleton-lyric-line" style={{ opacity: 0.35 }}><div className="skeleton skeleton-text" style={{ width: '75%', height: '1.4rem' }} /></div>
                <div className="skeleton-lyric-line" style={{ opacity: 0.55 }}><div className="skeleton skeleton-text" style={{ width: '60%', height: '1.4rem' }} /></div>
                <div className="skeleton-lyric-line" style={{ opacity: 1 }}><div className="skeleton skeleton-text" style={{ width: '85%', height: '2rem' }} /></div>
                <div className="skeleton-lyric-line" style={{ opacity: 0.55 }}><div className="skeleton skeleton-text" style={{ width: '65%', height: '1.4rem' }} /></div>
                <div className="skeleton-lyric-line" style={{ opacity: 0.35 }}><div className="skeleton skeleton-text" style={{ width: '80%', height: '1.4rem' }} /></div>
                <div className="skeleton-lyric-line" style={{ opacity: 0.15 }}><div className="skeleton skeleton-text" style={{ width: '55%', height: '1.4rem' }} /></div>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  )
}
