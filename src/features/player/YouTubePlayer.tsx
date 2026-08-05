import { Button } from '@astryxdesign/core/Button'
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup'
import { Pause, Play, StepForward } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatMs } from '../../shared/time/formatTime'
import {
  loadYouTubeIframeApi,
  YOUTUBE_PLAYER_STATE,
  type YouTubePlayerInstance,
  type YouTubePlayerStateChangeEvent,
} from './youtubeIframeApi'

const PLAYER_READY_TIMEOUT_MS = 10_000
const PLAYBACK_POLL_MS = 100

export interface SeekRequest {
  id: number
  timeMs: number
}

interface YouTubePlayerProps {
  videoId: string
  durationMs: number
  startOffsetMs: number
  seekRequest?: SeekRequest | null
  mock?: boolean
  onTimeUpdate: (timeMs: number) => void
}

interface PlayerSessionProps extends Omit<YouTubePlayerProps, 'mock' | 'startOffsetMs'> {
  initialTimeMs: number
}

interface RealPlayerController {
  player: YouTubePlayerInstance | null
  ready: boolean
  failed: boolean
  disposed: boolean
  playerState: number
  visible: boolean
  intervalId: number | null
  readyTimeoutId: number | null
}

function clampTime(timeMs: number, durationMs: number): number {
  return Math.min(durationMs, Math.max(0, timeMs))
}

function currentVisibility(): boolean {
  return document.visibilityState === 'visible'
}

function MockPlayerSession({
  durationMs,
  initialTimeMs,
  seekRequest = null,
  onTimeUpdate,
}: PlayerSessionProps) {
  const [playing, setPlaying] = useState(false)
  const [timeMs, setTimeMs] = useState(initialTimeMs)
  const timeMsRef = useRef(initialTimeMs)
  const durationMsRef = useRef(durationMs)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const lastSeekRequestIdRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    durationMsRef.current = durationMs
    onTimeUpdateRef.current = onTimeUpdate
  }, [durationMs, onTimeUpdate])

  const updateTime = useCallback((nextTimeMs: number) => {
    const safeTimeMs = clampTime(nextTimeMs, durationMsRef.current)
    timeMsRef.current = safeTimeMs
    setTimeMs(safeTimeMs)
    onTimeUpdateRef.current(safeTimeMs)
    if (safeTimeMs >= durationMsRef.current) {
      setPlaying(false)
    }
  }, [])

  useLayoutEffect(() => {
    onTimeUpdateRef.current(initialTimeMs)
  }, [initialTimeMs])

  useLayoutEffect(() => {
    if (!seekRequest || seekRequest.id === lastSeekRequestIdRef.current) {
      return
    }
    lastSeekRequestIdRef.current = seekRequest.id
    updateTime(seekRequest.timeMs)
  }, [seekRequest, updateTime])

  useEffect(() => {
    if (!playing) {
      return
    }
    const intervalId = window.setInterval(() => updateTime(timeMsRef.current + 250), 250)
    return () => window.clearInterval(intervalId)
  }, [playing, updateTime])

  return (
    <div className="mock-player" data-testid="mock-player">
      <div>
        <p className="text-sm uppercase tracking-wide text-[#97eeee]">Mock Player</p>
        <p className="mt-1 text-3xl font-black">{formatMs(timeMs)}</p>
      </div>
      <input
        aria-label="재생 위치"
        max={durationMs}
        min={0}
        onChange={(event) => updateTime(Number(event.currentTarget.value))}
        step={250}
        type="range"
        value={timeMs}
      />
      <div>
        <ButtonGroup label="Player controls" size="sm">
          <Button
            label={playing ? 'Pause' : 'Play'}
            icon={playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            onClick={() => setPlaying((value) => !value)}
            variant="secondary"
          />
          <Button
            label="+6s"
            icon={<StepForward size={16} aria-hidden="true" />}
            onClick={() => updateTime(timeMsRef.current + 6000)}
            variant="secondary"
          />
        </ButtonGroup>
      </div>
    </div>
  )
}

function RealPlayerSession({
  videoId,
  durationMs,
  initialTimeMs,
  seekRequest = null,
  onTimeUpdate,
}: PlayerSessionProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<RealPlayerController | null>(null)
  const pendingSeekRequestRef = useRef<SeekRequest | null>(null)
  const lastSeekRequestIdRef = useRef<number | null>(null)
  const onTimeUpdateRef = useRef(onTimeUpdate)
  const durationMsRef = useRef(durationMs)
  const executeSeekRef = useRef<(request: SeekRequest) => void>((request) => {
    pendingSeekRequestRef.current = request
  })
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryRevision, setRetryRevision] = useState(0)

  useLayoutEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate
    durationMsRef.current = durationMs
  }, [durationMs, onTimeUpdate])

  const publishTime = useCallback((timeMs: number) => {
    onTimeUpdateRef.current(clampTime(timeMs, durationMsRef.current))
  }, [])

  useEffect(() => {
    const abortController = new AbortController()
    const controller: RealPlayerController = {
      player: null,
      ready: false,
      failed: false,
      disposed: false,
      playerState: YOUTUBE_PLAYER_STATE.UNSTARTED,
      visible: currentVisibility(),
      intervalId: null,
      readyTimeoutId: null,
    }
    controllerRef.current = controller

    const stopPolling = () => {
      if (controller.intervalId !== null) {
        window.clearInterval(controller.intervalId)
        controller.intervalId = null
      }
    }
    const syncCurrentTime = () => {
      if (controller.ready && !controller.failed && !controller.disposed && controller.player) {
        publishTime(controller.player.getCurrentTime() * 1000)
      }
    }
    const reconcilePolling = () => {
      const shouldPoll = controller.ready
        && !controller.failed
        && !controller.disposed
        && controller.playerState === YOUTUBE_PLAYER_STATE.PLAYING
        && controller.visible
      if (!shouldPoll) {
        stopPolling()
      } else if (controller.intervalId === null) {
        controller.intervalId = window.setInterval(syncCurrentTime, PLAYBACK_POLL_MS)
      }
    }
    const handleVisibilityChange = () => {
      controller.visible = currentVisibility()
      syncCurrentTime()
      reconcilePolling()
    }
    const clearReadyTimeout = () => {
      if (controller.readyTimeoutId !== null) {
        window.clearTimeout(controller.readyTimeoutId)
        controller.readyTimeoutId = null
      }
    }
    const destroyPlayer = () => {
      stopPolling()
      clearReadyTimeout()
      const player = controller.player
      controller.player = null
      player?.destroy()
      hostRef.current?.replaceChildren()
    }
    const fail = (message: string) => {
      if (controller.disposed || controller.failed) {
        return
      }
      controller.failed = true
      setLoadState('error')
      setLoadError(message)
      destroyPlayer()
    }
    const executeSeek = (request: SeekRequest) => {
      if (!controller.ready || !controller.player || controller.failed || controller.disposed) {
        pendingSeekRequestRef.current = request
        return
      }
      const targetMs = clampTime(request.timeMs, durationMsRef.current)
      controller.player.seekTo(targetMs / 1000, true)
      publishTime(targetMs)
    }
    executeSeekRef.current = executeSeek

    const handleStateChange = (event: YouTubePlayerStateChangeEvent) => {
      if (!controller.ready || controller.failed || controller.disposed || event.data === controller.playerState) {
        return
      }
      controller.playerState = event.data
      syncCurrentTime()
      reconcilePolling()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    loadYouTubeIframeApi(abortController.signal).then(() => {
      if (controller.disposed || !window.YT?.Player) {
        return
      }
      const host = hostRef.current
      if (!host) {
        fail('YouTube 플레이어를 표시할 수 없습니다.')
        return
      }
      const mount = document.createElement('div')
      host.replaceChildren(mount)
      controller.readyTimeoutId = window.setTimeout(
        () => fail('YouTube 플레이어 준비 시간이 초과되었습니다.'),
        PLAYER_READY_TIMEOUT_MS,
      )
      controller.player = new window.YT.Player(mount, {
        videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(initialTimeMs / 1000) },
        events: {
          onError: () => fail('YouTube 플레이어를 시작하지 못했습니다.'),
          onReady: () => {
            if (controller.disposed || controller.failed || controller.ready || !controller.player) {
              return
            }
            controller.ready = true
            clearReadyTimeout()
            setLoadState('ready')
            setLoadError(null)
            const pendingSeekRequest = pendingSeekRequestRef.current
            if (pendingSeekRequest) {
              pendingSeekRequestRef.current = null
              executeSeek(pendingSeekRequest)
            } else {
              controller.player.seekTo(initialTimeMs / 1000, true)
              publishTime(initialTimeMs)
            }
            controller.playerState = controller.player.getPlayerState?.() ?? YOUTUBE_PLAYER_STATE.UNSTARTED
            controller.visible = currentVisibility()
            reconcilePolling()
          },
          onStateChange: handleStateChange,
        },
      })
    }).catch((error: unknown) => {
      if (controller.disposed || (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) {
        return
      }
      fail('YouTube 플레이어를 불러오지 못했습니다.')
    })

    return () => {
      controller.disposed = true
      abortController.abort()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      destroyPlayer()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
      executeSeekRef.current = (request) => {
        pendingSeekRequestRef.current = request
      }
    }
  }, [initialTimeMs, publishTime, retryRevision, videoId])

  useLayoutEffect(() => {
    if (!seekRequest || seekRequest.id === lastSeekRequestIdRef.current) {
      return
    }
    lastSeekRequestIdRef.current = seekRequest.id
    executeSeekRef.current(seekRequest)
  }, [seekRequest])

  return (
    <div
      aria-busy={loadState === 'loading'}
      className="youtube-player-wrapper"
      data-testid="youtube-player"
      style={{ display: 'contents' }}
    >
      <div ref={hostRef} className="youtube-player-host" />
      {loadState === 'loading' ? (
        <p className="text-sm text-[var(--color-text-secondary)]" role="status">
          YouTube 플레이어를 불러오는 중입니다.
        </p>
      ) : null}
      {loadState === 'ready' ? <p className="sr-only" role="status">YouTube 플레이어가 준비되었습니다.</p> : null}
      {loadState === 'error' ? (
        <div className="flex flex-col gap-3" role="alert">
          <p>{loadError}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              label="다시 시도"
              onClick={() => {
                setLoadState('loading')
                setLoadError(null)
                setRetryRevision((revision) => revision + 1)
              }}
              variant="secondary"
            />
            <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`} rel="noopener noreferrer" target="_blank">
              YouTube에서 열기
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function YouTubePlayer({ startOffsetMs, mock = false, ...props }: YouTubePlayerProps) {
  const initialTimeMs = clampTime(startOffsetMs, props.durationMs)
  const sessionKey = `${props.videoId}\u0000${props.durationMs}\u0000${initialTimeMs}\u0000${mock ? 'mock' : 'youtube'}`
  return mock
    ? <MockPlayerSession {...props} initialTimeMs={initialTimeMs} key={sessionKey} />
    : <RealPlayerSession {...props} initialTimeMs={initialTimeMs} key={sessionKey} />
}
