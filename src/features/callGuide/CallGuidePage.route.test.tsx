import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallGuideManifest, LoadResult, LyricLine, SongGuide } from '../data/types'
import type { PlaybackTimeStore } from '../player/playbackTimeStore'
import type { CountdownCue } from './countdownSchedule'

const harness = vi.hoisted(() => ({
  fetchCallGuideManifest: vi.fn(),
  fetchSong: vi.fn(),
  lyricRenderStates: [] as Array<string | null>,
  countdownSchedules: [] as readonly CountdownCue[][],
  playbackUpdate: null as ((timeMs: number) => void) | null,
  playbackTimeStore: null as PlaybackTimeStore | null,
  seekToLine: null as ((line: LyricLine) => void) | null,
  seekRequest: null as { id: number; timeMs: number } | null,
  startOffsetMs: null as number | null,
  songId: 'song-a',
}))

vi.mock('react-router', () => ({
  useParams: () => ({ songId: harness.songId }),
}))

vi.mock('../../app/config', () => ({
  getRootManifestUrl: () => 'https://example.test/manifest.json',
  shouldUseMockPlayer: () => true,
}))

vi.mock('../data/callGuideSession', () => ({
  loadCallGuideManifest: harness.fetchCallGuideManifest,
  loadCallGuideSong: harness.fetchSong,
}))

vi.mock('../player/YouTubePlayer', () => ({
  YouTubePlayer: ({
    onTimeUpdate,
    seekRequest,
    startOffsetMs,
  }: {
    onTimeUpdate: (timeMs: number) => void
    seekRequest: { id: number; timeMs: number } | null
    startOffsetMs: number
  }) => {
    harness.playbackUpdate = onTimeUpdate
    harness.seekRequest = seekRequest
    harness.startOffsetMs = startOffsetMs
    return null
  },
}))

vi.mock('./LyricList', () => ({
  LyricList: ({
    countdownSchedule,
    activeLineId,
    onSeekToLine,
    playbackTimeStore,
  }: {
    countdownSchedule: readonly CountdownCue[]
    activeLineId: string | null
    onSeekToLine: (line: LyricLine) => void
    playbackTimeStore: PlaybackTimeStore
  }) => {
    harness.lyricRenderStates.push(activeLineId)
    harness.countdownSchedules.push(countdownSchedule)
    harness.seekToLine = onSeekToLine
    harness.playbackTimeStore = playbackTimeStore
    return <div data-testid="active-lyric">{activeLineId ?? 'none'}</div>
  },
}))

vi.mock('../../shared/layout/AppHeader', () => ({
  AppHeader: ({ endContent }: { endContent: ReactNode }) => <>{endContent}</>,
}))

vi.mock('@astryxdesign/core/AppShell', () => ({
  AppShell: ({ children, topNav }: { children: ReactNode; topNav: ReactNode }) => <>{topNav}{children}</>,
}))

vi.mock('@astryxdesign/core/Layout', () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LayoutContent: ({ children, ...props }: { children: ReactNode; 'aria-busy'?: boolean }) => (
    <div data-testid="layout-content" {...props}>{children}</div>
  ),
}))

vi.mock('@astryxdesign/core/Banner', () => ({
  Banner: ({ endContent, role, title }: { endContent?: ReactNode; role?: string; title: string }) => (
    <div role={role}>{title}{endContent}</div>
  ),
}))

vi.mock('@astryxdesign/core/Button', () => ({
  Button: ({ href, label, onClick }: { href?: string; label: string; onClick?: () => void }) => (
    href ? <a href={href}>{label}</a> : <button onClick={onClick} type="button">{label}</button>
  ),
}))

vi.mock('@astryxdesign/core/Skeleton', () => ({
  Skeleton: () => <span>Loading</span>,
}))

vi.mock('@astryxdesign/core/StatusDot', () => ({
  StatusDot: ({ label }: { label: string }) => <span>{label}</span>,
}))

vi.mock('@astryxdesign/core/theme', () => ({
  Theme: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@astryxdesign/theme-neutral/built', () => ({
  neutralTheme: {},
}))

import { CallGuidePage } from './CallGuidePage'

function manifestResult(): LoadResult<CallGuideManifest> & { url: string } {
  return {
    data: {
      schemaVersion: 1,
      generatedAt: '2026-07-01T00:00:00.000Z',
      dataVersion: 'v1',
      songs: ['song-a', 'song-b'].map((id) => ({
        id,
        title: { ko: id },
        artist: { ko: 'Artist' },
        youtubeVideoId: `${id}-video`,
        tags: [],
        path: `songs/${id}.json`,
        status: 'published' as const,
      })),
    },
    source: 'network',
    url: 'https://example.test/call-guide-manifest.json',
  }
}

function songResult(id: string, title: string): LoadResult<SongGuide> {
  return {
    data: {
      schemaVersion: 1,
      dataVersion: 'v1',
      id,
      status: 'published',
      metadata: {
        title: { ko: title },
        artist: { ko: 'Artist' },
        vocal: ['hatsune-miku'],
        tags: [],
      },
      youtube: {
        videoId: `${id}-video`,
        originalSongId: `${id}-original`,
        startOffsetMs: 0,
      },
      display: {
        defaultLyricsLanguage: 'ja',
        defaultPronunciationLanguage: 'koPronunciation',
        defaultCallLanguage: 'ko',
      },
      timing: { unit: 'ms', durationMs: 1000 },
      lyrics: [],
      callEvents: [],
    },
    source: 'network',
  }
}

beforeEach(() => {
  harness.fetchCallGuideManifest.mockReset()
  harness.fetchSong.mockReset()
  harness.lyricRenderStates = []
  harness.countdownSchedules = []
  harness.playbackUpdate = null
  harness.playbackTimeStore = null
  harness.seekToLine = null
  harness.seekRequest = null
  harness.startOffsetMs = null
  harness.songId = 'song-a'
  harness.fetchCallGuideManifest.mockResolvedValue(manifestResult())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('CallGuidePage route identity', () => {
  it('announces loading and marks the content busy while the song is deferred', () => {
    harness.fetchCallGuideManifest.mockImplementationOnce(() => new Promise(() => {}))

    render(<CallGuidePage />)

    expect(screen.getByTestId('layout-content')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('곡 가이드를 불러오는 중입니다.')
  })

  it('does not render song A while a rerendered song B route is loading', async () => {
    let resolveSongB: ((result: LoadResult<SongGuide>) => void) | undefined
    harness.fetchSong
      .mockResolvedValueOnce(songResult('song-a', 'Song A'))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSongB = resolve
      }))

    const { rerender } = render(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()

    harness.songId = 'song-b'
    rerender(<CallGuidePage />)

    expect(screen.queryByRole('heading', { name: 'Song A' })).not.toBeInTheDocument()
    await waitFor(() => expect(harness.fetchSong).toHaveBeenCalledTimes(2))

    await act(async () => {
      resolveSongB?.(songResult('song-b', 'Song B'))
    })
    expect(await screen.findByRole('heading', { name: 'Song B' })).toBeInTheDocument()
  })

  it('does not retain song A when the rerendered song B route fails', async () => {
    harness.fetchSong
      .mockResolvedValueOnce(songResult('song-a', 'Song A'))
      .mockRejectedValueOnce(new Error('Song B load failed.'))

    const { rerender } = render(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()

    harness.songId = 'song-b'
    rerender(<CallGuidePage />)

    expect(await screen.findByText('Song B load failed.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Song A' })).not.toBeInTheDocument()
  })

  it('shows an alert with retry and catalog recovery, then reloads successfully', async () => {
    harness.fetchCallGuideManifest
      .mockRejectedValueOnce(new Error('Song load failed.'))
      .mockResolvedValueOnce(manifestResult())
    harness.fetchSong.mockResolvedValueOnce(songResult('song-a', 'Song A'))

    render(<CallGuidePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Song load failed.')
    expect(screen.getByRole('link', { name: '카탈로그로 돌아가기' })).toHaveAttribute('href', '/')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()
    expect(harness.fetchCallGuideManifest).toHaveBeenCalledTimes(2)
    expect(harness.fetchCallGuideManifest.mock.calls[1][1]).toMatchObject({ force: true })
  })

  it('forces only the song load when retrying a valid manifest after a song failure', async () => {
    harness.fetchSong
      .mockRejectedValueOnce(new Error('Song data failed.'))
      .mockResolvedValueOnce(songResult('song-a', 'Song A'))

    render(<CallGuidePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Song data failed.')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()
    expect(harness.fetchCallGuideManifest).toHaveBeenCalledTimes(2)
    expect(harness.fetchCallGuideManifest.mock.calls[1][1]).toMatchObject({ force: false })
    expect(harness.fetchSong).toHaveBeenCalledTimes(2)
    expect(harness.fetchSong.mock.calls[1][2]).toMatchObject({ force: true })
  })

  it('consumes a successful retry so returning to the route does not force it again', async () => {
    harness.fetchSong
      .mockRejectedValueOnce(new Error('Song A failed.'))
      .mockResolvedValueOnce(songResult('song-a', 'Song A'))
      .mockResolvedValueOnce(songResult('song-b', 'Song B'))
      .mockResolvedValueOnce(songResult('song-a', 'Song A again'))

    const { rerender } = render(<CallGuidePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Song A failed.')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()
    expect(harness.fetchSong.mock.calls[1][2]).toMatchObject({ force: true })

    harness.songId = 'song-b'
    rerender(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song B' })).toBeInTheDocument()

    harness.songId = 'song-a'
    rerender(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A again' })).toBeInTheDocument()
    expect(harness.fetchSong.mock.calls[3][2]).toMatchObject({ force: false })
  })

  it('consumes a manifest retry before a pending song load when leaving and returning', async () => {
    harness.fetchCallGuideManifest.mockRejectedValueOnce(new Error('Manifest failed.'))
    harness.fetchSong
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(songResult('song-b', 'Song B'))
      .mockResolvedValueOnce(songResult('song-a', 'Song A after return'))

    const { rerender } = render(<CallGuidePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Manifest failed.')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(harness.fetchSong).toHaveBeenCalledTimes(1))
    expect(harness.fetchCallGuideManifest.mock.calls[1][1]).toMatchObject({ force: true })

    harness.songId = 'song-b'
    rerender(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song B' })).toBeInTheDocument()

    harness.songId = 'song-a'
    rerender(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A after return' })).toBeInTheDocument()
    expect(harness.fetchCallGuideManifest.mock.calls[3][1]).toMatchObject({ force: false })
  })

  it('aborts an in-flight song request on unmount', async () => {
    let requestSignal: AbortSignal | undefined
    harness.fetchSong.mockImplementationOnce((...args) => {
      requestSignal = args[2].signal
      return new Promise(() => {})
    })

    const { unmount } = render(<CallGuidePage />)
    await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal))

    unmount()

    expect(requestSignal?.aborted).toBe(true)
  })

  it('shows an unexpected upstream AbortError when its own request is still active', async () => {
    harness.fetchCallGuideManifest.mockRejectedValueOnce(new DOMException('Upstream aborted.', 'AbortError'))

    render(<CallGuidePage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Upstream aborted.')
  })

  it('rerenders the guide only when playback crosses a lyric boundary', async () => {
    const result = songResult('song-a', 'Song A')
    result.data.timing.durationMs = 2000
    result.data.lyrics = [
      { id: 'line-1', startMs: 0, endMs: 1000, text: { ja: 'one' } },
      { id: 'line-2', startMs: 1000, endMs: 2000, text: { ja: 'two' } },
    ]
    harness.fetchSong.mockResolvedValueOnce(result)

    render(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()
    const rendersAfterLoad = harness.lyricRenderStates.length

    act(() => harness.playbackUpdate?.(100))
    act(() => harness.playbackUpdate?.(200))
    expect(harness.lyricRenderStates).toHaveLength(rendersAfterLoad)

    act(() => harness.playbackUpdate?.(1000))
    await waitFor(() => expect(harness.lyricRenderStates).toHaveLength(rendersAfterLoad + 1))
    expect(harness.lyricRenderStates.at(-1)).toBe('line-2')
  })

  it('seeks a lyric to its effective countdown start without changing the player start offset', async () => {
    const result = songResult('song-a', 'Song A')
    result.data.youtube.startOffsetMs = 1000
    result.data.timing.durationMs = 8000
    result.data.lyrics = [
      { id: 'line-1', startMs: 6000, endMs: 8000, text: { ja: 'one' } },
    ]
    harness.fetchSong.mockResolvedValueOnce(result)

    render(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()

    expect(harness.startOffsetMs).toBe(1000)
    expect(harness.countdownSchedules.at(-1)).toEqual([
      { id: 'auto:first-lyric:line-1', startMs: 3000, endMs: 6000, source: 'auto' },
    ])

    act(() => harness.seekToLine?.(result.data.lyrics[0]))

    expect(harness.seekRequest?.timeMs).toBe(3000)
    expect(screen.getByText('0:01.0')).toBeInTheDocument()
    act(() => harness.playbackUpdate?.(3000))
    expect(screen.getByText('0:03.0')).toBeInTheDocument()
  })

  it('initializes playback state at the player start offset', async () => {
    const result = songResult('song-a', 'Song A')
    result.data.youtube.startOffsetMs = 1000
    result.data.countdownEvents = [{
      id: 'before-start-offset',
      time: '00:00:00,000 --> 00:00:00,500',
      startMs: 0,
      endMs: 500,
    }]
    harness.fetchSong.mockResolvedValueOnce(result)

    render(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()

    expect(screen.getByTestId('active-lyric')).toHaveTextContent('none')
    expect(harness.playbackTimeStore?.getSnapshot()).toBe(1000)
  })

  it('rerenders only at global call start and end boundaries within one lyric', async () => {
    const result = songResult('song-a', 'Song A')
    result.data.timing.durationMs = 2000
    result.data.lyrics = [
      { id: 'line-1', startMs: 0, endMs: 2000, text: { ja: 'one' } },
    ]
    result.data.callEvents = [{
      activation: { mode: 'manualTime' },
      cue: { kind: 'chant', intensity: 'normal', repeat: 1 },
      endMs: 1000,
      id: 'global-call-1',
      lyricLineId: null,
      markers: {
        point: { enabled: false, style: 'none', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
      placement: { align: 'timeline', lane: 'above', mode: 'globalTrack' },
      startMs: 500,
      text: { ko: '콜' },
      time: '00:00.500',
    }]
    harness.fetchSong.mockResolvedValueOnce(result)

    render(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()
    const rendersAfterLoad = harness.lyricRenderStates.length

    act(() => harness.playbackUpdate?.(100))
    act(() => harness.playbackUpdate?.(400))
    expect(harness.lyricRenderStates).toHaveLength(rendersAfterLoad)

    act(() => harness.playbackUpdate?.(500))
    await waitFor(() => expect(harness.lyricRenderStates).toHaveLength(rendersAfterLoad + 1))
    expect(screen.getByText('콜')).toBeInTheDocument()
    act(() => harness.playbackUpdate?.(700))
    act(() => harness.playbackUpdate?.(900))
    expect(harness.lyricRenderStates).toHaveLength(rendersAfterLoad + 1)

    act(() => harness.playbackUpdate?.(1000))
    await waitFor(() => expect(harness.lyricRenderStates).toHaveLength(rendersAfterLoad + 2))
    expect(screen.queryByText('콜')).not.toBeInTheDocument()
  })

  it('resets the playback boundary when the song route changes', async () => {
    const songA = songResult('song-a', 'Song A')
    songA.data.timing.durationMs = 2000
    songA.data.lyrics = [
      { id: 'line-a-1', startMs: 0, endMs: 500, text: { ja: 'one' } },
      { id: 'line-a-2', startMs: 500, endMs: 2000, text: { ja: 'two' } },
    ]
    const songB = songResult('song-b', 'Song B')
    songB.data.lyrics = [
      { id: 'line-b', startMs: 0, endMs: 1000, text: { ja: 'two' } },
    ]
    harness.fetchSong
      .mockResolvedValueOnce(songA)
      .mockResolvedValueOnce(songB)

    const { rerender } = render(<CallGuidePage />)
    expect(await screen.findByRole('heading', { name: 'Song A' })).toBeInTheDocument()
    act(() => harness.playbackUpdate?.(750))
    await waitFor(() => expect(harness.lyricRenderStates.at(-1)).toBe('line-a-2'))

    harness.songId = 'song-b'
    rerender(<CallGuidePage />)

    expect(await screen.findByRole('heading', { name: 'Song B' })).toBeInTheDocument()
    expect(harness.lyricRenderStates.at(-1)).toBe('line-b')
    expect(screen.getByText('0:00.0')).toBeInTheDocument()
  })
})
