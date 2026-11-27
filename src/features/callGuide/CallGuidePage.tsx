import { AlertTriangle, CircleAlert, Megaphone } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import './callGuide.css'
import { getRootManifestUrl, shouldUseMockPlayer } from '../../app/config'
import { localizedText } from '../../shared/i18n/localizedText'
import { loadCallGuideManifest, loadCallGuideSong } from '../data/callGuideSession'
import type { ResolvedLoadResult } from '../data/fetchCallGuideManifest'
import type { CallGuideManifest, LoadResult, LyricLine, SongGuide } from '../data/types'
import { PlaybackClock } from '../player/PlaybackClock'
import {
  createPlaybackBoundaryIndex,
  type PlaybackBoundaryIndex,
  type PlaybackBoundarySnapshot,
} from '../player/playbackBoundaryIndex'
import { createPlaybackTimeStore } from '../player/playbackTimeStore'
import { YouTubePlayer } from '../player/YouTubePlayer'
import {
  callKindLegend,
  callKindsInSong,
  groupCallsByLineId,
  normalizedCallKind,
} from './callPositioning'
import { orderedCallsForDisplay } from './lyricGeometry'
import { buildCountdownSchedule, countdownStartForLyric } from './countdownSchedule'
import { LyricList } from './LyricList'
import { AppHeader } from '../../shared/layout/AppHeader'
import { AccessibleAppShell } from '../../shared/layout/AccessibleAppShell'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Button } from '@astryxdesign/core/Button'
import { Theme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'

type LoadStage = 'manifest' | 'song'

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

export function CallGuidePage() {
  const { songId } = useParams()
  const [loaded, setLoaded] = useState<{
    requestKey: string
    manifestResult: ResolvedLoadResult<CallGuideManifest>
    songResult: LoadResult<SongGuide>
  } | null>(null)
  const [playbackSnapshot, setPlaybackSnapshot] = useState<PlaybackBoundarySnapshot | null>(null)
  // Remembers the last sung line so the "next call" strip stays correct between lines.
  const [lastActiveLineId, setLastActiveLineId] = useState<string | null>(null)
  const [playbackTimeStore] = useState(() => createPlaybackTimeStore())
  const [seekRequest, setSeekRequest] = useState<{ id: number; timeMs: number } | null>(null)
  const [loadError, setLoadError] = useState<{
    requestKey: string
    message: string
    stage: LoadStage
  } | null>(null)
  const [retryRequest, setRetryRequest] = useState<{
    revision: number
    rootManifestUrl: string | null
    songId: string | null
    stage: LoadStage | null
  }>({ revision: 0, rootManifestUrl: null, songId: null, stage: null })
  const playbackBoundaryIndexRef = useRef<PlaybackBoundaryIndex | null>(null)
  const playbackSnapshotRef = useRef<PlaybackBoundarySnapshot | null>(null)
  const consumedRetryRevisionRef = useRef<number | null>(null)
  const seekRequestIdRef = useRef(0)
  const rootManifestUrl = getRootManifestUrl()
  const mockPlayer = shouldUseMockPlayer()
  const requestKey = `${rootManifestUrl}\u0000${songId ?? ''}\u0000${retryRequest.revision}`

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const retryStage = (
      retryRequest.rootManifestUrl === rootManifestUrl
      && retryRequest.songId === songId
      && consumedRetryRevisionRef.current !== retryRequest.revision
    ) ? retryRequest.stage : null

    async function loadInitialSong() {
      if (!songId) {
        await Promise.resolve()
        if (!cancelled) {
          setLoadError({ requestKey, message: 'Song id was missing.', stage: 'manifest' })
        }
        return
      }

      let loadedManifest: ResolvedLoadResult<CallGuideManifest>
      try {
        loadedManifest = await loadCallGuideManifest(rootManifestUrl, {
          force: retryStage === 'manifest',
          signal: controller.signal,
        })
        if (retryStage === 'manifest') {
          consumedRetryRevisionRef.current = retryRequest.revision
        }
      } catch (loadError) {
        if (isAbortError(loadError) && controller.signal.aborted) {
          return
        }
        if (!cancelled) {
          setLoadError({
            requestKey,
            message: errorMessage(loadError, 'Manifest load failed.'),
            stage: 'manifest',
          })
        }
        return
      }

      const manifestSong = loadedManifest.data.songs.find((song) => song.id === songId)
      if (!manifestSong) {
        if (!cancelled) {
          setLoadError({
            requestKey,
            message: `Song "${songId}" was not found in manifest.`,
            stage: 'manifest',
          })
        }
        return
      }

      try {
        const loadedSong = await loadCallGuideSong(loadedManifest, manifestSong, {
          force: retryStage === 'song',
          signal: controller.signal,
        })

        if (!cancelled) {
          const initialPlaybackMs = loadedSong.data.youtube.startOffsetMs
          const playbackBoundaryIndex = createPlaybackBoundaryIndex(loadedSong.data)
          const initialSnapshot = playbackBoundaryIndex.snapshotAt(initialPlaybackMs)
          playbackBoundaryIndexRef.current = playbackBoundaryIndex
          playbackSnapshotRef.current = initialSnapshot
          if (retryStage === 'song') {
            consumedRetryRevisionRef.current = retryRequest.revision
          }
          setLoaded({ requestKey, manifestResult: loadedManifest, songResult: loadedSong })
          playbackTimeStore.set(initialPlaybackMs)
          setPlaybackSnapshot(initialSnapshot)
          setLastActiveLineId(initialSnapshot.activeLineId)
          setSeekRequest(null)
          setLoadError(null)
        }
      } catch (loadError) {
        if (isAbortError(loadError) && controller.signal.aborted) {
          return
        }
        if (!cancelled) {
          setLoadError({
            requestKey,
            message: errorMessage(loadError, 'Song load failed.'),
            stage: 'song',
          })
        }
      }
    }

    void loadInitialSong()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [playbackTimeStore, requestKey, retryRequest, rootManifestUrl, songId])

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

  const activeLine = playbackSnapshot?.activeLine ?? null
  const globalCalls = playbackSnapshot?.globalCalls ?? []
  const callLegendKinds = useMemo(() => (song ? callKindsInSong(song.callEvents) : []), [song])
  const countdownSchedule = useMemo(() => (song ? buildCountdownSchedule(song) : []), [song])
  const callsByLineId = useMemo(() => (song ? groupCallsByLineId(song.callEvents) : null), [song])
  const upcomingCall = useMemo(() => {
    if (!song || !callsByLineId) {
      return null
    }
    const anchorLineId = activeLine?.id ?? lastActiveLineId
    const anchorIndex = anchorLineId ? song.lyrics.findIndex((line) => line.id === anchorLineId) : -1
    // The current line's calls are "now"; otherwise look ahead from the line after the last one sung.
    const searchFrom = activeLine ? anchorIndex : anchorIndex + 1
    for (let index = Math.max(0, searchFrom); index < song.lyrics.length; index += 1) {
      const calls = callsByLineId.get(song.lyrics[index].id)
      if (calls && calls.length > 0) {
        return {
          isNow: Boolean(activeLine) && index === anchorIndex,
          text: localizedText(orderedCallsForDisplay(calls)[0].text, song.display.defaultCallLanguage, ['ko', 'ja', 'romaji', 'en']),
        }
      }
    }
    return null
  }, [activeLine, callsByLineId, lastActiveLineId, song])

  const publishPlaybackTime = useCallback((timeMs: number) => {
    playbackTimeStore.set(timeMs)
    const playbackBoundaryIndex = playbackBoundaryIndexRef.current
    if (!playbackBoundaryIndex) {
      return
    }

    const nextSnapshot = playbackBoundaryIndex.snapshotAt(timeMs)
    if (nextSnapshot === playbackSnapshotRef.current) {
      return
    }

    playbackSnapshotRef.current = nextSnapshot
    setPlaybackSnapshot(nextSnapshot)
    if (nextSnapshot.activeLineId) {
      setLastActiveLineId(nextSnapshot.activeLineId)
    }
  }, [playbackTimeStore])
  
  const seekToLine = useCallback((line: LyricLine) => {
    const targetMs = countdownStartForLyric(countdownSchedule, line.startMs) ?? line.startMs
    seekRequestIdRef.current += 1
    setSeekRequest({ id: seekRequestIdRef.current, timeMs: targetMs })
  }, [countdownSchedule])

  return (
    <Theme theme={neutralTheme} mode="dark">
      <div className="call-guide-scroll-runway">
        <div className="call-guide-sticky-frame">
          <AccessibleAppShell
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
                <div className="status-banner flex items-center gap-3" role="alert">
                  <AlertTriangle aria-hidden="true" className="shrink-0" size={20} />
                  <p className="m-0">
                    {currentManifestResult?.warning ?? currentSongResult?.warning ?? ''}
                  </p>
                </div>
              </div>
            ) : null}

        {error ? (
          <div className="mx-4 my-2">
            <div className="status-banner flex flex-wrap items-center gap-3" role="alert">
              <CircleAlert aria-hidden="true" className="shrink-0" size={20} />
              <p className="m-0 min-w-72 flex-1">{error}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  label="다시 시도"
                  onClick={() => setRetryRequest((current) => ({
                    revision: current.revision + 1,
                    rootManifestUrl,
                    songId: songId ?? null,
                    stage: loadError?.requestKey === requestKey ? loadError.stage : 'manifest',
                  }))}
                  variant="secondary"
                />
                <Button
                  href="/"
                  label="카탈로그로 돌아가기"
                  variant="ghost"
                />
              </div>
            </div>
          </div>
        ) : null}

        <LayoutContent aria-busy={isLoading} className="px-0">
          {song ? (
            <div className="player-grid">
              <section className="player-video-panel">
                <div className="player-video-stack flex flex-col gap-4">
                  <div className="player-title-block">
                    <h1 className="text-2xl font-bold m-0">{localizedText(song.metadata.title, 'ko', ['ja', 'en'])}</h1>
                    <span className="text-sm text-[var(--color-text-secondary)]">{localizedText(song.metadata.artist, 'ko', ['ja', 'en'])}</span>
                  </div>
                  <div className="video-frame">
                    <YouTubePlayer
                      durationMs={song.timing.durationMs}
                      mock={mockPlayer}
                      onTimeUpdate={publishPlaybackTime}
                      seekRequest={seekRequest}
                      startOffsetMs={song.youtube.startOffsetMs}
                      videoId={song.youtube.videoId}
                    />
                  </div>
                  <div className="player-active-meta" data-state={upcomingCall?.isNow ? 'now' : 'next'}>
                    <Megaphone size={17} aria-hidden="true" />
                    <span className="player-active-meta-label">{upcomingCall?.isNow ? '지금 콜' : '다음 콜'}</span>
                    <span className="player-active-meta-call">{upcomingCall ? upcomingCall.text : '남은 콜이 없어요'}</span>
                  </div>
                </div>
              </section>

              <section className="live-lyrics-panel" id="lyrics-practice-section" tabIndex={-1}>
                {callLegendKinds.length > 0 ? (
                  <div className="call-legend-row flex items-center gap-2">
                  <aside aria-label="콜 타입 안내" className="call-kind-legend">
                    <span className="call-kind-legend-title">콜 종류</span>
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
                  <details className="call-reading-guide">
                    <summary className="flex min-h-touch-target items-center rounded-[var(--radius-element)] border px-3 text-sm font-semibold">읽는 법</summary>
                    <ul>
                      <li><strong>↑ ↓</strong> 화살표가 가리키는 글자에서 콜을 외쳐요. 위 칸은 가사 위, 아래 칸은 가사 아래 콜이에요.</li>
                      <li><strong>┌ ┐</strong> 괄호로 묶인 구간 동안 콜을 이어서 외쳐요.</li>
                      <li><strong>가사 누르기</strong> 그 줄로 이동해 3·2·1 카운트다운 뒤에 시작해요.</li>
                    </ul>
                  </details>
                  </div>
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
                <LyricList
                  activeLineId={playbackSnapshot?.activeLineId ?? null}
                  countdownSchedule={countdownSchedule}
                  onSeekToLine={seekToLine}
                  playbackTimeStore={playbackTimeStore}
                  song={song}
                />
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
        </AccessibleAppShell>
        </div>
      </div>
    </Theme>
  )
}
