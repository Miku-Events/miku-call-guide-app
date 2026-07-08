import { Pause, Play, StepForward } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { formatMs } from '../../shared/time/formatTime'
import { Button } from '@astryxdesign/core/Button'
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup'

type YouTubePlayerInstance = {
  getCurrentTime: () => number
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void
  destroy: () => void
}

type YouTubeConstructor = new (
  elementId: string,
  options: {
    videoId: string
    playerVars: Record<string, string | number>
    events: {
      onReady?: () => void
    }
  },
) => YouTubePlayerInstance

declare global {
  interface Window {
    YT?: {
      Player: YouTubeConstructor
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<void> | null = null

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) {
    return Promise.resolve()
  }

  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previousReady = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previousReady?.()
        resolve()
      }

      const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]')
      if (!existing) {
        const script = document.createElement('script')
        script.src = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(script)
      } else if (window.YT?.Player) {
        resolve()
      } else {
        // Fallback for hot reloading / pre-existing script tag
        const interval = window.setInterval(() => {
          if (window.YT?.Player) {
            window.clearInterval(interval)
            resolve()
          }
        }, 50)
      }
    })
  }

  return apiPromise
}

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
  const playerId = `youtube-player-${useId().replace(/:/g, '')}`
  const playerRef = useRef<YouTubePlayerInstance | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [mockPlaying, setMockPlaying] = useState(false)
  const [mockTimeMs, setMockTimeMs] = useState(() => clampTime(startOffsetMs, durationMs))
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

    let intervalId = 0
    let disposed = false

    loadYouTubeApi().then(() => {
      if (disposed || !window.YT?.Player) {
        return
      }

      if (wrapperRef.current) {
        wrapperRef.current.innerHTML = ''
        const container = document.createElement('div')
        container.id = playerId
        wrapperRef.current.appendChild(container)
      }

      playerRef.current = new window.YT.Player(playerId, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          start: Math.floor(initialTimeMs / 1000),
        },
        events: {
          onReady: () => {
            playerRef.current?.seekTo(initialTimeMs / 1000, true)
            onTimeUpdate(initialTimeMs)
            intervalId = window.setInterval(() => {
              if (playerRef.current) {
                onTimeUpdate(playerRef.current.getCurrentTime() * 1000)
              }
            }, 100)
          },
        },
      })
    })

    return () => {
      disposed = true
      window.clearInterval(intervalId)
      playerRef.current?.destroy()
      playerRef.current = null
      if (wrapperRef.current) {
        wrapperRef.current.innerHTML = ''
      }
    }
  }, [initialTimeMs, mock, onTimeUpdate, playerId, videoId])

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

  return <div ref={wrapperRef} className="youtube-player-wrapper" style={{ display: 'contents' }} />
})
