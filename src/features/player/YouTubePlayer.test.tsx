import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YOUTUBE_IFRAME_API_SRC } from './youtubeIframeApi'
import { YouTubePlayer } from './YouTubePlayer'

const VIDEO_ID = 'M7lc1UVf-VE'

function playerInstance(currentTime = 122) {
  return {
    destroy: vi.fn(),
    getCurrentTime: vi.fn(() => currentTime),
    seekTo: vi.fn(),
  }
}

describe('YouTubePlayer', () => {
  afterEach(() => {
    vi.useRealTimers()
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
    const playerInstance = { destroy, getCurrentTime, seekTo }
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
    expect(onTimeUpdate).toHaveBeenCalledWith(156540)
  })

  it('uses startOffsetMs only as the initial playback position', async () => {
    const seekTo = vi.fn()
    const destroy = vi.fn()
    const getCurrentTime = vi.fn(() => 122)
    const playerInstance = { destroy, getCurrentTime, seekTo }
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

  it('stops the 100ms playback poll and destroys the player on unmount', async () => {
    vi.useFakeTimers()
    const instance = playerInstance(12.5)
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
