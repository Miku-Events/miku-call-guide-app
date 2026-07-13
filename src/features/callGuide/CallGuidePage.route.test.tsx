import type { ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallGuideManifest, LoadResult, SongGuide } from '../data/types'

const harness = vi.hoisted(() => ({
  fetchCallGuideManifest: vi.fn(),
  fetchSong: vi.fn(),
  songId: 'song-a',
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ songId: harness.songId }),
}))

vi.mock('../../app/config', () => ({
  getRootManifestUrl: () => 'https://example.test/manifest.json',
  shouldUseMockPlayer: () => true,
}))

vi.mock('../data/fetchManifest', () => ({
  fetchCallGuideManifest: harness.fetchCallGuideManifest,
}))

vi.mock('../data/fetchSong', () => ({
  fetchSong: harness.fetchSong,
}))

vi.mock('../player/YouTubePlayer', () => ({
  YouTubePlayer: () => null,
}))

vi.mock('./LyricList', () => ({
  LyricList: () => null,
}))

vi.mock('./callPositioning', () => ({
  activeGlobalCalls: () => [],
  callKindLegend: {},
  callKindsInSong: () => [],
  findActiveLyric: () => null,
  localizedText: (text: Record<string, string | undefined>) => Object.values(text).find(Boolean) ?? '',
  normalizedCallKind: () => 'chant',
}))

vi.mock('../../shared/layout/AppHeader', () => ({
  AppHeader: ({ endContent }: { endContent: ReactNode }) => <>{endContent}</>,
}))

vi.mock('@astryxdesign/core/AppShell', () => ({
  AppShell: ({ children, topNav }: { children: ReactNode; topNav: ReactNode }) => <>{topNav}{children}</>,
}))

vi.mock('@astryxdesign/core/Layout', () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LayoutContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@astryxdesign/core/Banner', () => ({
  Banner: ({ title }: { title: string }) => <div>{title}</div>,
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
  harness.songId = 'song-a'
  harness.fetchCallGuideManifest.mockResolvedValue(manifestResult())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('CallGuidePage route identity', () => {
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
})
