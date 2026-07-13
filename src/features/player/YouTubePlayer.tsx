import { Pause, Play, StepForward } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { formatMs } from '../../shared/time/formatTime'
import { Button } from '@astryxdesign/core/Button'
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup'
import { loadYouTubeIframeApi, type YouTubePlayerInstance } from './youtubeIframeApi'

const PLAYER_READY_TIMEOUT_MS = 10_000
const PLAYBACK_POLL_MS = 100

interface YouTubePlayerProps {
  videoId: string
  durationMs: number
  startOffsetMs: number
  seekRequest?: { id: number; timeMs: number } | null
  mock?: boolean
  onTimeUpdate: (timeMs: number) => void
}

export interface YouTubePlayerHandle {
  seekTo: (timeMs: number) => void
}

function clampTime(timeMs: number, durationMs: number): number {
  return Math.min(durationMs, Math.max(0, timeMs))
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(function YouTubePlayer({
  videoId,
  durationMs,
  startOffsetMs,
  seekRequest = null,
  mock = false,
  onTimeUpdate,
}, ref) {
  const playerRef = useRef<YouTubePlayerInstance | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [mockPlaying, setMockPlaying] = useState(false)
  const [mockTimeMs, setMockTimeMs] = useState(() => clampTime(startOffsetMs, durationMs))
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryRevision, setRetryRevision] = useState(0)
  const initialTimeMs = clampTime(startOffsetMs, durationMs)

  const seekTo = useCallback((targetMs: number) => {
    const safeTargetMs = clampTime(targetMs, durationMs)
    if (mock) {
      setMockTimeMs(safeTargetMs)
      return
    }

    const playerSeconds = safeTargetMs / 1000
    playerRef.current?.seekTo(playerSeconds, true)
    onTimeUpdate(safeTargetMs)
  }, [durationMs, mock, onTimeUpdate])

  useImperativeHandle(ref, () => ({ seekTo }), [seekTo])

  useEffect(() => {
    if (seekRequest) {
      seekTo(seekRequest.timeMs)
    }
  }, [seekRequest, seekTo])

  useEffect(() => {
    if (mock) {
      setMockTimeMs(initialTimeMs)
    }
  }, [initialTimeMs, mock, videoId])

  useEffect(() => {
    if (mock) {
      onTimeUpdate(mockTimeMs)
    }
  }, [mock, mockTimeMs, onTimeUpdate])

  useEffect(() => {
    if (!mock || !mockPlaying) {
      return
    }

    const id = window.setInterval(() => {
      setMockTimeMs((value) => Math.min(durationMs, value + 250))
    }, 250)

    return () => window.clearInterval(id)
  }, [durationMs, mock, mockPlaying])

  useEffect(() => {
    if (mock) {
      return
    }

    const controller = new AbortController()
    let intervalId = 0
    let readyTimeoutId = 0
    let disposed = false
    let failed = false
    let ready = false
    let player: YouTubePlayerInstance | null = null

    setLoadState('loading')
    setLoadError(null)

    const clearScheduledWork = () => {
      window.clearInterval(intervalId)
      window.clearTimeout(readyTimeoutId)
    }

    const destroyPlayer = () => {
      clearScheduledWork()
      if (playerRef.current === player) {
        playerRef.current = null
      }
      player?.destroy()
      player = null
      hostRef.current?.replaceChildren()
    }

    const fail = (message: string) => {
      if (disposed || failed) return
      failed = true
      setLoadState('error')
      setLoadError(message)
      destroyPlayer()
    }

    loadYouTubeIframeApi(controller.signal).then(() => {
      if (disposed || !window.YT?.Player) {
        return
      }

      const host = hostRef.current
      if (!host) {
        fail('YouTube 플레이어를 표시할 수 없습니다.')
        return
      }
      const mount = document.createElement('div')
      host.replaceChildren(mount)

      readyTimeoutId = window.setTimeout(() => {
        fail('YouTube 플레이어 준비 시간이 초과되었습니다.')
      }, PLAYER_READY_TIMEOUT_MS)

      player = new window.YT.Player(mount, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          start: Math.floor(initialTimeMs / 1000),
        },
        events: {
          onError: () => {
            fail('YouTube 플레이어를 시작하지 못했습니다.')
          },
          onReady: () => {
            if (disposed || failed || ready) return
            ready = true
            window.clearTimeout(readyTimeoutId)
            setLoadState('ready')
            setLoadError(null)
            playerRef.current?.seekTo(initialTimeMs / 1000, true)
            onTimeUpdate(initialTimeMs)
            intervalId = window.setInterval(() => {
              if (playerRef.current) {
                onTimeUpdate(playerRef.current.getCurrentTime() * 1000)
              }
            }, PLAYBACK_POLL_MS)
          },
        },
      })
      playerRef.current = player
    }).catch((error: unknown) => {
      if (disposed || (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')) {
        return
      }
      fail('YouTube 플레이어를 불러오지 못했습니다.')
    })

    return () => {
      disposed = true
      controller.abort()
      destroyPlayer()
    }
  }, [initialTimeMs, mock, onTimeUpdate, retryRevision, videoId])

  if (mock) {
    return (
      <div className="mock-player" data-testid="mock-player">
        <div>
          <p className="text-sm uppercase tracking-wide text-[#97eeee]">Mock Player</p>
          <p className="mt-1 text-3xl font-black">{formatMs(mockTimeMs)}</p>
        </div>
        <input
          aria-label="재생 위치"
          max={durationMs}
          min={0}
          onChange={(event) => setMockTimeMs(Number(event.currentTarget.value))}
          step={250}
          type="range"
          value={mockTimeMs}
        />
        <div>
          <ButtonGroup label="Player controls" size="sm">
            <Button
              label={mockPlaying ? 'Pause' : 'Play'}
              icon={mockPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              onClick={() => setMockPlaying((value) => !value)}
              variant="secondary"
            />
            <Button
              label="+6s"
              icon={<StepForward size={16} aria-hidden="true" />}
              onClick={() => setMockTimeMs((value) => Math.min(durationMs, value + 6000))}
              variant="secondary"
            />
          </ButtonGroup>
        </div>
      </div>
    )
  }

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
      {loadState === 'ready' ? (
        <p className="sr-only" role="status">YouTube 플레이어가 준비되었습니다.</p>
      ) : null}
      {loadState === 'error' ? (
        <div className="flex flex-col gap-3" role="alert">
          <p>{loadError}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              label="다시 시도"
              onClick={() => setRetryRevision((revision) => revision + 1)}
              variant="secondary"
            />
            <a
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              YouTube에서 열기
            </a>
          </div>
        </div>
      ) : null}
    </div>
  )
})
