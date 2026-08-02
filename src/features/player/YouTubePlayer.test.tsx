import { useLayoutEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YOUTUBE_IFRAME_API_SRC, YOUTUBE_PLAYER_STATE } from './youtubeIframeApi'
import { YouTubePlayer } from './YouTubePlayer'

const VIDEO_ID = 'M7lc1UVf-VE'

function playerInstance(currentTime = 122, playerState: number = YOUTUBE_PLAYER_STATE.UNSTARTED) {
  return {
    destroy: vi.fn(),
    getCurrentTime: vi.fn(() => currentTime),
    getPlayerState: vi.fn(() => playerState),
    seekTo: vi.fn(),
  }
}

describe('YouTubePlayer', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete window.YT
    delete window.onYouTubeIframeAPIReady
    document.querySelectorAll(`script[src="${YOUTUBE_IFRAME_API_SRC}"]`).forEach((script) => script.remove())
  })

  it('announces loading while the API is unavailable', () => {
    render(<YouTubePlayer durationMs={360000} onTimeUpdate={vi.fn()} startOffsetMs={0} videoId={VIDEO_ID} />)

    expect(screen.getByTestId('youtube-player')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('YouTube 플레이어를 불러오는 중입니다.')
  })

  it('seeks to the runtime timestamp directly', async () => {
    const seekTo = vi.fn()
    const destroy = vi.fn()
    const getCurrentTime = vi.fn(() => 156.54)
    const getPlayerState = vi.fn(() => YOUTUBE_PLAYER_STATE.PAUSED)
    const playerInstance = { destroy, getCurrentTime, getPlayerState, seekTo }
    const Player = vi.fn(function Player(_elementId: string, options: { events: { onReady?: () => void } }) {
      queueMicrotask(() => options.events.onReady?.())
      return playerInstance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }

    const onTimeUpdate = vi.fn()
    const { rerender } = render(
      <YouTubePlayer durationMs={360000} onTimeUpdate={onTimeUpdate} startOffsetMs={122000} videoId={VIDEO_ID} />,
    )

    await waitFor(() => expect(Player).toHaveBeenCalled())

    rerender(
      <YouTubePlayer
        durationMs={360000}
        onTimeUpdate={onTimeUpdate}
        seekRequest={{ id: 1, timeMs: 156540 }}
        startOffsetMs={122000}
        videoId={VIDEO_ID}
      />,
    )

    await waitFor(() => expect(seekTo).toHaveBeenCalledWith(156.54, true))
    expect(seekTo).toHaveBeenCalledTimes(2)
    expect(onTimeUpdate).toHaveBeenCalledTimes(2)
    expect(onTimeUpdate).toHaveBeenLastCalledWith(156540)

    rerender(
      <YouTubePlayer
        durationMs={360000}
        onTimeUpdate={onTimeUpdate}
        seekRequest={{ id: 1, timeMs: 156540 }}
        startOffsetMs={122000}
        videoId={VIDEO_ID}
      />,
    )
    expect(seekTo).toHaveBeenCalledTimes(2)
    expect(onTimeUpdate).toHaveBeenCalledTimes(2)
  })

  it('uses startOffsetMs only as the initial playback position', async () => {
    const seekTo = vi.fn()
    const destroy = vi.fn()
    const getCurrentTime = vi.fn(() => 122)
    const getPlayerState = vi.fn(() => YOUTUBE_PLAYER_STATE.UNSTARTED)
    const playerInstance = { destroy, getCurrentTime, getPlayerState, seekTo }
    const Player = vi.fn(function Player(
      _elementId: string,
      options: { events: { onReady?: () => void }; playerVars: Record<string, string | number> },
    ) {
      queueMicrotask(() => options.events.onReady?.())
      return playerInstance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }

    const onTimeUpdate = vi.fn()
    render(<YouTubePlayer durationMs={360000} onTimeUpdate={onTimeUpdate} startOffsetMs={122000} videoId={VIDEO_ID} />)

    await waitFor(() => expect(Player).toHaveBeenCalled())
    expect(Player.mock.calls[0][1].playerVars.start).toBe(122)
    await waitFor(() => expect(seekTo).toHaveBeenCalledWith(122, true))
    expect(onTimeUpdate).toHaveBeenCalledWith(122000)
  })

  it('announces readiness after the player onReady callback', async () => {
    const instance = playerInstance()
    let receivedElement: HTMLElement | string | undefined
    const Player = vi.fn(function Player(
      element: HTMLElement | string,
      options: { events: { onReady?: () => void } },
    ) {
      receivedElement = element
      queueMicrotask(() => options.events.onReady?.())
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }

    render(<YouTubePlayer durationMs={360000} onTimeUpdate={vi.fn()} startOffsetMs={0} videoId={VIDEO_ID} />)

    expect(await screen.findByText('YouTube 플레이어가 준비되었습니다.')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('youtube-player')).toHaveAttribute('aria-busy', 'false')
    expect(receivedElement).toBeInstanceOf(HTMLElement)
  })

  it('shows recovery actions when the YouTube player reports an error', async () => {
    const instance = playerInstance()
    const Player = vi.fn(function Player(
      _element: HTMLElement,
      options: { events: { onError?: () => void } },
    ) {
      queueMicrotask(() => options.events.onError?.())
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }

    render(<YouTubePlayer durationMs={360000} onTimeUpdate={vi.fn()} startOffsetMs={0} videoId={VIDEO_ID} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube 플레이어를 시작하지 못했습니다.')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'YouTube에서 열기' })).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    )
  })

  it('recreates the player after a failed attempt is retried', async () => {
    const firstInstance = playerInstance()
    const secondInstance = playerInstance()
    let attempt = 0
    let firstHost: HTMLElement | undefined
    let retryHost: HTMLElement | undefined
    const Player = vi.fn(function Player(
      element: HTMLElement,
      options: { events: { onError?: () => void; onReady?: () => void } },
    ) {
      attempt += 1
      if (attempt === 1) {
        firstHost = element
        element.replaceWith(document.createElement('iframe'))
        queueMicrotask(() => options.events.onError?.())
        return firstInstance
      }
      retryHost = element
      queueMicrotask(() => options.events.onReady?.())
      return secondInstance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }

    render(<YouTubePlayer durationMs={360000} onTimeUpdate={vi.fn()} startOffsetMs={0} videoId={VIDEO_ID} />)
    fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))

    expect(await screen.findByText('YouTube 플레이어가 준비되었습니다.')).toHaveAttribute('role', 'status')
    expect(Player).toHaveBeenCalledTimes(2)
    expect(firstInstance.destroy).toHaveBeenCalledOnce()
    expect(retryHost).not.toBe(firstHost)
    expect(retryHost?.isConnected).toBe(true)
  })

  it('fails when the player does not become ready within ten seconds', async () => {
    vi.useFakeTimers()
    const instance = playerInstance()
    const Player = vi.fn(function Player() {
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }

    render(<YouTubePlayer durationMs={360000} onTimeUpdate={vi.fn()} startOffsetMs={0} videoId={VIDEO_ID} />)
    await act(async () => {})
    await act(async () => vi.advanceTimersByTimeAsync(10_000))

    expect(screen.getByRole('alert')).toHaveTextContent('YouTube 플레이어 준비 시간이 초과되었습니다.')
  })

  it('ignores a late ready callback after the ready timeout has failed', async () => {
    vi.useFakeTimers()
    const instance = playerInstance()
    let notifyReady: (() => void) | undefined
    const Player = vi.fn(function Player(
      _element: HTMLElement,
      options: { events: { onReady?: () => void } },
    ) {
      notifyReady = options.events.onReady
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }

    render(<YouTubePlayer durationMs={360000} onTimeUpdate={vi.fn()} startOffsetMs={0} videoId={VIDEO_ID} />)
    await act(async () => {})
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(screen.getByRole('alert')).toHaveTextContent('YouTube 플레이어 준비 시간이 초과되었습니다.')

    await act(async () => notifyReady?.())

    expect(screen.getByRole('alert')).toHaveTextContent('YouTube 플레이어 준비 시간이 초과되었습니다.')
    expect(screen.queryByText('YouTube 플레이어가 준비되었습니다.')).not.toBeInTheDocument()
    expect(instance.destroy).toHaveBeenCalledOnce()
  })

  it('polls only while playing and synchronizes each distinct player-state transition once', async () => {
    vi.useFakeTimers()
    const instance = playerInstance(12.5)
    let notifyStateChange: ((event: { data: number }) => void) | undefined
    const Player = vi.fn(function Player(
      _element: HTMLElement,
      options: {
        events: {
          onReady?: () => void
          onStateChange?: (event: { data: number }) => void
        }
      },
    ) {
      notifyStateChange = options.events.onStateChange
      queueMicrotask(() => options.events.onReady?.())
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const onTimeUpdate = vi.fn()

    render(<YouTubePlayer durationMs={360000} onTimeUpdate={onTimeUpdate} startOffsetMs={0} videoId={VIDEO_ID} />)
    await act(async () => {})
    onTimeUpdate.mockClear()

    act(() => notifyStateChange?.({ data: YOUTUBE_PLAYER_STATE.PLAYING }))
    expect(onTimeUpdate).toHaveBeenCalledOnce()
    expect(intervalSpy).toHaveBeenCalledOnce()

    act(() => notifyStateChange?.({ data: YOUTUBE_PLAYER_STATE.PLAYING }))
    expect(onTimeUpdate).toHaveBeenCalledOnce()
    expect(intervalSpy).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(onTimeUpdate).toHaveBeenCalledTimes(4)

    for (const stoppedState of [
      YOUTUBE_PLAYER_STATE.PAUSED,
      YOUTUBE_PLAYER_STATE.BUFFERING,
      YOUTUBE_PLAYER_STATE.ENDED,
      YOUTUBE_PLAYER_STATE.CUED,
      YOUTUBE_PLAYER_STATE.UNSTARTED,
    ]) {
      act(() => notifyStateChange?.({ data: stoppedState }))
      const callsAfterTransition = onTimeUpdate.mock.calls.length
      await act(async () => vi.advanceTimersByTimeAsync(200))
      expect(onTimeUpdate).toHaveBeenCalledTimes(callsAfterTransition)
    }
  })

  it('stops while hidden and synchronizes before resuming a single poll when visible', async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    const instance = playerInstance(8)
    let notifyStateChange: ((event: { data: number }) => void) | undefined
    const Player = vi.fn(function Player(
      _element: HTMLElement,
      options: {
        events: {
          onReady?: () => void
          onStateChange?: (event: { data: number }) => void
        }
      },
    ) {
      notifyStateChange = options.events.onStateChange
      queueMicrotask(() => options.events.onReady?.())
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }
    const onTimeUpdate = vi.fn()

    render(<YouTubePlayer durationMs={360000} onTimeUpdate={onTimeUpdate} startOffsetMs={0} videoId={VIDEO_ID} />)
    await act(async () => {})
    onTimeUpdate.mockClear()
    act(() => notifyStateChange?.({ data: YOUTUBE_PLAYER_STATE.PLAYING }))
    await act(async () => vi.advanceTimersByTimeAsync(100))

    visibility = 'hidden'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    const callsWhileHiding = onTimeUpdate.mock.calls.length
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(onTimeUpdate).toHaveBeenCalledTimes(callsWhileHiding)

    visibility = 'visible'
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(onTimeUpdate).toHaveBeenCalledTimes(callsWhileHiding + 1)
    await act(async () => vi.advanceTimersByTimeAsync(100))
    expect(onTimeUpdate).toHaveBeenCalledTimes(callsWhileHiding + 2)
  })

  it('keeps only the latest seek received before readiness and does not overwrite it with the initial offset', async () => {
    const instance = playerInstance()
    let notifyReady: (() => void) | undefined
    const Player = vi.fn(function Player(
      _element: HTMLElement,
      options: { events: { onReady?: () => void } },
    ) {
      notifyReady = options.events.onReady
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }
    const onTimeUpdate = vi.fn()
    const { rerender } = render(
      <YouTubePlayer
        durationMs={360000}
        onTimeUpdate={onTimeUpdate}
        seekRequest={{ id: 1, timeMs: 15000 }}
        startOffsetMs={5000}
        videoId={VIDEO_ID}
      />,
    )
    await waitFor(() => expect(Player).toHaveBeenCalledOnce())

    rerender(
      <YouTubePlayer
        durationMs={360000}
        onTimeUpdate={onTimeUpdate}
        seekRequest={{ id: 2, timeMs: 20000 }}
        startOffsetMs={5000}
        videoId={VIDEO_ID}
      />,
    )
    await act(async () => {})
    act(() => notifyReady?.())

    expect(instance.seekTo).toHaveBeenCalledOnce()
    expect(instance.seekTo).toHaveBeenCalledWith(20, true)
    expect(instance.seekTo).not.toHaveBeenCalledWith(5, true)
    expect(onTimeUpdate).toHaveBeenCalledOnce()
    expect(onTimeUpdate).toHaveBeenCalledWith(20000)
  })

  it('captures a committed seek before an ancestor layout callback can report readiness', async () => {
    const instance = playerInstance()
    let notifyReady: (() => void) | undefined
    const Player = vi.fn(function Player(
      _element: HTMLElement,
      options: { events: { onReady?: () => void } },
    ) {
      notifyReady = options.events.onReady
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }
    const onTimeUpdate = vi.fn()

    function ReadyHarness({ seekRequest }: { seekRequest: { id: number; timeMs: number } | null }) {
      useLayoutEffect(() => {
        if (seekRequest) {
          notifyReady?.()
        }
      }, [seekRequest])

      return (
        <YouTubePlayer
          durationMs={360000}
          onTimeUpdate={onTimeUpdate}
          seekRequest={seekRequest}
          startOffsetMs={5000}
          videoId={VIDEO_ID}
        />
      )
    }

    const { rerender } = render(<ReadyHarness seekRequest={null} />)
    await waitFor(() => expect(Player).toHaveBeenCalledOnce())

    rerender(<ReadyHarness seekRequest={{ id: 2, timeMs: 20000 }} />)

    expect(instance.seekTo).toHaveBeenCalledOnce()
    expect(instance.seekTo).toHaveBeenCalledWith(20, true)
    expect(instance.seekTo).not.toHaveBeenCalledWith(5, true)
    expect(onTimeUpdate).toHaveBeenCalledOnce()
    expect(onTimeUpdate).toHaveBeenCalledWith(20000)
  })

  it('publishes a seek once per request while paused without starting a poll', async () => {
    vi.useFakeTimers()
    const instance = playerInstance(5, YOUTUBE_PLAYER_STATE.PAUSED)
    const Player = vi.fn(function Player(
      _element: HTMLElement,
      options: { events: { onReady?: () => void } },
    ) {
      queueMicrotask(() => options.events.onReady?.())
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }
    const intervalSpy = vi.spyOn(window, 'setInterval')
    const onTimeUpdate = vi.fn()
    const { rerender } = render(
      <YouTubePlayer durationMs={360000} onTimeUpdate={onTimeUpdate} startOffsetMs={5000} videoId={VIDEO_ID} />,
    )
    await act(async () => {})
    instance.seekTo.mockClear()
    onTimeUpdate.mockClear()

    rerender(
      <YouTubePlayer
        durationMs={360000}
        onTimeUpdate={onTimeUpdate}
        seekRequest={{ id: 10, timeMs: 9000 }}
        startOffsetMs={5000}
        videoId={VIDEO_ID}
      />,
    )
    await act(async () => {})
    rerender(
      <YouTubePlayer
        durationMs={360000}
        onTimeUpdate={onTimeUpdate}
        seekRequest={{ id: 10, timeMs: 9000 }}
        startOffsetMs={5000}
        videoId={VIDEO_ID}
      />,
    )
    await act(async () => vi.advanceTimersByTimeAsync(500))

    expect(instance.seekTo).toHaveBeenCalledOnce()
    expect(instance.seekTo).toHaveBeenCalledWith(9, true)
    expect(onTimeUpdate).toHaveBeenCalledOnce()
    expect(onTimeUpdate).toHaveBeenCalledWith(9000)
    expect(intervalSpy).not.toHaveBeenCalled()
  })

  it('stops the mock timer when playback reaches the song duration', async () => {
    vi.useFakeTimers()
    const onTimeUpdate = vi.fn()
    render(
      <YouTubePlayer
        durationMs={500}
        mock
        onTimeUpdate={onTimeUpdate}
        startOffsetMs={0}
        videoId={VIDEO_ID}
      />,
    )
    await act(async () => {})
    onTimeUpdate.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(onTimeUpdate).toHaveBeenLastCalledWith(500)
    const callsAtEnd = onTimeUpdate.mock.calls.length

    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(onTimeUpdate).toHaveBeenCalledTimes(callsAtEnd)
  })

  it('stops the 100ms playback poll and destroys the player on unmount', async () => {
    vi.useFakeTimers()
    const instance = playerInstance(12.5, YOUTUBE_PLAYER_STATE.PLAYING)
    const Player = vi.fn(function Player(
      _element: HTMLElement,
      options: { events: { onReady?: () => void } },
    ) {
      queueMicrotask(() => options.events.onReady?.())
      return instance
    })
    window.YT = { Player: Player as unknown as NonNullable<typeof window.YT>['Player'] }
    const onTimeUpdate = vi.fn()

    const { unmount } = render(
      <YouTubePlayer durationMs={360000} onTimeUpdate={onTimeUpdate} startOffsetMs={0} videoId={VIDEO_ID} />,
    )
    await act(async () => {})
    await act(async () => vi.advanceTimersByTimeAsync(100))
    const callsBeforeUnmount = onTimeUpdate.mock.calls.length

    unmount()
    await act(async () => vi.advanceTimersByTimeAsync(500))

    expect(onTimeUpdate).toHaveBeenCalledTimes(callsBeforeUnmount)
    expect(instance.destroy).toHaveBeenCalledOnce()
  })
})
