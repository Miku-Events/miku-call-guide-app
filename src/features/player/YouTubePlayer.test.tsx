import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YouTubePlayer } from './YouTubePlayer'

describe('YouTubePlayer', () => {
  afterEach(() => {
    delete window.YT
    delete window.onYouTubeIframeAPIReady
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
      <YouTubePlayer durationMs={360000} onTimeUpdate={onTimeUpdate} startOffsetMs={122000} videoId="M7lc1UVf-VE" />,
    )

    await waitFor(() => expect(Player).toHaveBeenCalled())

    rerender(
      <YouTubePlayer
        durationMs={360000}
        onTimeUpdate={onTimeUpdate}
        seekRequest={{ id: 1, timeMs: 156540 }}
        startOffsetMs={122000}
        videoId="M7lc1UVf-VE"
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
    render(<YouTubePlayer durationMs={360000} onTimeUpdate={onTimeUpdate} startOffsetMs={122000} videoId="M7lc1UVf-VE" />)

    await waitFor(() => expect(Player).toHaveBeenCalled())
    expect(Player.mock.calls[0][1].playerVars.start).toBe(122)
    await waitFor(() => expect(seekTo).toHaveBeenCalledWith(122, true))
    expect(onTimeUpdate).toHaveBeenCalledWith(122000)
  })
})
