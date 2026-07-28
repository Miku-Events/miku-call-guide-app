import { ListMusic } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router'
import './callGuide.css'
import { getRootManifestUrl, shouldUseMockPlayer } from '../../app/config'
import { localizedText } from '../../shared/i18n/localizedText'
import { fetchCallGuideManifest } from '../data/fetchManifest'
import { fetchSong } from '../data/fetchSong'
import type { CallGuideManifest, LoadResult, LyricLine, SongGuide } from '../data/types'
import { PlaybackClock } from '../player/PlaybackClock'
import { createPlaybackTimeStore } from '../player/playbackTimeStore'
import { YouTubePlayer, type YouTubePlayerHandle } from '../player/YouTubePlayer'
import {
  activeGlobalCalls,
  callKindLegend,
  callKindsInSong,
  findActiveLyric,
  normalizedCallKind,
} from './callPositioning'
import { LyricList } from './LyricList'
import { AppShell } from '@astryxdesign/core/AppShell'
import { AppHeader } from '../../shared/layout/AppHeader'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { Banner } from '@astryxdesign/core/Banner'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Button } from '@astryxdesign/core/Button'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

function playbackBoundaryKey(song: SongGuide, currentMs: number): string {
  const activeLineId = findActiveLyric(song.lyrics, currentMs)?.id ?? ''
  const globalCallIds = activeGlobalCalls(song.callEvents, currentMs).map((call) => call.id)
  return JSON.stringify([activeLineId, globalCallIds])
}

export function CallGuidePage() {
  const { songId } = useParams()
  const [loaded, setLoaded] = useState<{
    requestKey: string
    manifestResult: LoadResult<CallGuideManifest>
    songResult: LoadResult<SongGuide>
  } | null>(null)
  const [boundaryMs, setBoundaryMs] = useState(0)
  const [playbackTimeStore] = useState(() => createPlaybackTimeStore())
  const [seekRequest, setSeekRequest] = useState<{ id: number; timeMs: number } | null>(null)
  const [loadError, setLoadError] = useState<{ requestKey: string; message: string } | null>(null)
  const [retryRevision, setRetryRevision] = useState(0)
  const playerRef = useRef<YouTubePlayerHandle | null>(null)
  const playbackBoundaryKeyRef = useRef('')
  const seekRequestIdRef = useRef(0)
  const rootManifestUrl = getRootManifestUrl()
  const mockPlayer = shouldUseMockPlayer()
  const requestKey = `${rootManifestUrl}\u0000${songId ?? ''}\u0000${retryRevision}`

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function loadInitialSong() {
      if (!songId) {
        await Promise.resolve()
        if (!cancelled) {
          setLoadError({ requestKey, message: 'Song id was missing.' })
        }
        return
      }

      try {
        const loadedManifest = await fetchCallGuideManifest(rootManifestUrl)
        const manifestSong = loadedManifest.data.songs.find((song) => song.id === songId)
        if (!manifestSong) {
          throw new Error(`Song "${songId}" was not found in manifest.`)
        }

        const loadedSong = await fetchSong(loadedManifest.url, manifestSong.path, songId, {
          expectedDataVersion: loadedManifest.data.dataVersion,
          signal: controller.signal,
        })

        if (!cancelled) {
          setLoaded({ requestKey, manifestResult: loadedManifest, songResult: loadedSong })
          playbackTimeStore.set(0)
          playbackBoundaryKeyRef.current = playbackBoundaryKey(loadedSong.data, 0)
          setBoundaryMs(0)
          setSeekRequest(null)
          setLoadError(null)
        }
      } catch (loadError) {
        if (loadError && typeof loadError === 'object' && 'name' in loadError && loadError.name === 'AbortError') {
          return
        }
        if (!cancelled) {
          setLoadError({
            requestKey,
            message: loadError instanceof Error ? loadError.message : 'Song load failed.',
          })
        }
      }
    }

    void loadInitialSong()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [playbackTimeStore, requestKey, rootManifestUrl, songId])

  const currentLoad = loaded?.requestKey === requestKey ? loaded : null
  const currentSongResult = currentLoad && currentLoad.songResult.data.id === songId ? currentLoad.songResult : null
  const currentManifestResult = currentSongResult ? currentLoad?.manifestResult ?? null : null
  const error = loadError?.requestKey === requestKey ? loadError.message : null
  const song = currentSongResult?.data
  const isLoading = Boolean(songId) && !song && !error

  useEffect(() => {
    if (song) {
      const title = localizedText(song.metadata.title, 'ko', ['ja', 'en'])
      const artist = localizedText(song.metadata.artist, 'ko', ['ja', 'en'])
      document.title = `${title} (${artist}) - 콜 가이드 - 하츠네 미쿠 콜 가이드`
    } else {
      document.title = '곡 상세 - 하츠네 미쿠 콜 가이드'
    }
  }, [song])

  const activeLine = useMemo(() => (song ? findActiveLyric(song.lyrics, boundaryMs) : null), [boundaryMs, song])
  const globalCalls = useMemo(() => (song ? activeGlobalCalls(song.callEvents, boundaryMs) : []), [boundaryMs, song])
  const callLegendKinds = useMemo(() => (song ? callKindsInSong(song.callEvents) : []), [song])

  const publishPlaybackTime = useCallback((timeMs: number) => {
    playbackTimeStore.set(timeMs)
    if (!song) {
      return
    }

    const nextBoundaryKey = playbackBoundaryKey(song, timeMs)
    if (nextBoundaryKey === playbackBoundaryKeyRef.current) {
      return
    }

    playbackBoundaryKeyRef.current = nextBoundaryKey
    setBoundaryMs(timeMs)
  }, [playbackTimeStore, song])
  
  const seekToLine = useCallback((line: LyricLine) => {
    seekRequestIdRef.current += 1
    publishPlaybackTime(line.startMs)
    setSeekRequest({ id: seekRequestIdRef.current, timeMs: line.startMs })
    playerRef.current?.seekTo(line.startMs)
  }, [publishPlaybackTime])

  return (
    <Theme theme={neutralTheme} mode="dark">
      <AppShell
        height="fill"
        variant="elevated"
        contentPadding={0}
        className="player-shell"
      topNav={
        <AppHeader
          activeNav="practice"
          endContent={
            <div className="flex items-center gap-3">
              <StatusDot
                variant={currentManifestResult?.source === 'cache' || currentSongResult?.source === 'cache' ? 'accent' : 'success'}
                label={currentManifestResult?.source === 'cache' || currentSongResult?.source === 'cache' ? 'cached' : 'live'}
              />
              <div className="player-clock font-mono text-sm px-2 py-0.5 rounded-[var(--radius-inner)] border border-[var(--color-border)] bg-[var(--color-background-surface)]">
                <PlaybackClock active={Boolean(song)} store={playbackTimeStore} />
              </div>
            </div>
          }
        />
      }
    >
      <Layout className="player-main">
        {currentManifestResult?.warning || currentSongResult?.warning ? (
          <div className="mx-4 my-2">
            <Banner
              status="warning"
              title={currentManifestResult?.warning ?? currentSongResult?.warning ?? ''}
              container="card"
            />
          </div>
        ) : null}

        {error ? (
          <div className="mx-4 my-2">
            <Banner
              status="error"
              title={error}
              container="card"
              role="alert"
              endContent={(
                <div className="flex flex-wrap gap-2">
                  <Button
                    label="다시 시도"
                    onClick={() => setRetryRevision((revision) => revision + 1)}
                    variant="secondary"
                  />
                  <Button
                    href="/"
                    label="카탈로그로 돌아가기"
                    variant="ghost"
                  />
                </div>
              )}
            />
          </div>
        ) : null}

        <LayoutContent aria-busy={isLoading} className="px-0">
          {song ? (
            <div className="player-grid">
              <section className="player-video-panel">
                <div className="player-video-stack flex flex-col gap-4">
                  <div className="player-title-block">
                    <p className="app-kicker">Call Guide Practice</p>
                    <h1 className="text-2xl font-bold m-0">{localizedText(song.metadata.title, 'ko', ['ja', 'en'])}</h1>
                    <span className="text-sm text-[var(--color-text-secondary)]">{localizedText(song.metadata.artist, 'ko', ['ja', 'en'])}</span>
                  </div>
                  <div className="video-frame">
                    <YouTubePlayer
                      durationMs={song.timing.durationMs}
                      mock={mockPlayer}
                      onTimeUpdate={publishPlaybackTime}
                      ref={playerRef}
                      seekRequest={seekRequest}
                      startOffsetMs={song.youtube.startOffsetMs}
                      videoId={song.youtube.videoId}
                    />
                  </div>
                  <div className="player-active-meta flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                    <ListMusic size={17} aria-hidden="true" />
                    <span>{activeLine ? activeLine.id : 'No active lyric line'}</span>
                  </div>
                </div>
              </section>

              <section className="live-lyrics-panel" id="lyrics-practice-section" tabIndex={-1}>
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
                <LyricList currentMs={boundaryMs} onSeekToLine={seekToLine} song={song} />
              </section>
            </div>
          ) : !error ? (
            <div className="player-grid">
              <p className="px-4 text-sm text-[var(--color-text-secondary)]" role="status">
                곡 가이드를 불러오는 중입니다.
              </p>
              <section className="player-video-panel">
                <div className="player-video-stack flex flex-col gap-4">
                  <div className="player-title-block flex flex-col gap-2">
                    <Skeleton width="30%" height="0.8rem" radius={1} />
                    <Skeleton width="70%" height="2rem" radius={1} />
                    <Skeleton width="40%" height="1rem" radius={1} />
                  </div>
                  <div className="video-frame min-h-[200px]">
                    <Skeleton width="100%" height="100%" radius={2} />
                  </div>
                  <div className="player-active-meta flex items-center gap-2">
                    <Skeleton width="20%" height="1rem" radius={1} />
                  </div>
                </div>
              </section>

              <section className="live-lyrics-panel">
                <div className="mb-4">
                  <Skeleton width="100%" height="2.2rem" radius={2} />
                </div>
                <div className="skeleton-lyric-list flex flex-col gap-3">
                  <Skeleton width="50%" height="1.4rem" radius={1} index={0} />
                  <Skeleton width="75%" height="1.4rem" radius={1} index={1} />
                  <Skeleton width="60%" height="1.4rem" radius={1} index={2} />
                  <Skeleton width="85%" height="2rem" radius={1} index={3} />
                  <Skeleton width="65%" height="1.4rem" radius={1} index={4} />
                  <Skeleton width="80%" height="1.4rem" radius={1} index={5} />
                  <Skeleton width="55%" height="1.4rem" radius={1} index={6} />
                </div>
              </section>
            </div>
          ) : null}
        </LayoutContent>
      </Layout>
    </AppShell>
  </Theme>
)
}
