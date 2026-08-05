import type { ChangeEvent, ComponentProps, ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallGuideManifest, LoadResult } from '../data/types'

const harness = vi.hoisted(() => ({
  fetchCallGuideManifest: vi.fn(),
  loadCallGuideRoute: vi.fn(() => Promise.resolve({})),
  prefetchCallGuideSong: vi.fn(() => Promise.resolve()),
  intersectionObserverCreations: 0,
  songCardRenders: new Map<string, number>(),
}))

vi.mock('../../app/config', () => ({
  getRootManifestUrl: () => 'https://example.test/manifest.json',
}))

vi.mock('../data/callGuideSession', () => ({
  loadCallGuideManifest: harness.fetchCallGuideManifest,
  prefetchCallGuideSong: harness.prefetchCallGuideSong,
}))

vi.mock('../callGuide/loadCallGuideRoute', () => ({
  loadCallGuideRoute: harness.loadCallGuideRoute,
}))

vi.mock('./SongCard', async (importOriginal) => {
  const React = await import('react')
  const actual = await importOriginal<typeof import('./SongCard')>()
  const CountedSongCard = React.memo((props: ComponentProps<typeof actual.SongCard>) => {
    const id = props.entry.song.id
    harness.songCardRenders.set(id, (harness.songCardRenders.get(id) ?? 0) + 1)
    return React.createElement(actual.SongCard, props)
  })
  CountedSongCard.displayName = 'CountedSongCard'
  return { SongCard: CountedSongCard }
})

vi.mock('../../shared/layout/AppPageShell', () => ({
  AppPageShell: ({
    children,
    className,
    toolbar,
  }: {
    children: ReactNode
    className?: string
    toolbar?: ReactNode
  }) => (
    <div className={className}>
      <main className="app-main">
        {toolbar}
        {children}
      </main>
    </div>
  ),
  StatusBanner: ({ action, children }: { action?: ReactNode; children: ReactNode }) => (
    <div>
      {children}
      {action}
    </div>
  ),
}))

vi.mock('@astryxdesign/core/TextInput', () => ({
  TextInput: ({
    label,
    onChange,
    value,
  }: {
    label: string
    onChange: (value: string) => void
    value: string
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        value={value}
      />
    </label>
  ),
}))

vi.mock('@astryxdesign/core/Button', () => ({
  Button: ({
    isDisabled,
    isLoading,
    label,
    onClick,
  }: {
    isDisabled?: boolean
    isLoading?: boolean
    label: string
    onClick?: () => void
  }) => (
    <button aria-busy={isLoading} disabled={isDisabled} onClick={onClick} type="button">
      {label}
    </button>
  ),
}))

vi.mock('@astryxdesign/core/Banner', () => ({
  Banner: ({ endContent, title }: { endContent?: ReactNode; title: ReactNode }) => (
    <div>
      {title}
      {endContent}
    </div>
  ),
}))

vi.mock('@astryxdesign/core/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
}))

import { CatalogPage } from './CatalogPage'

function catalogResult(dataVersion: string): LoadResult<CallGuideManifest> {
  const songs: CallGuideManifest['songs'] = [
    {
      id: 'song-a',
      title: { ko: 'Alpha' },
      artist: { ko: 'Artist A' },
      youtubeVideoId: 'video-a',
      tags: ['event'],
      path: 'songs/song-a.json',
      status: 'published',
    },
    {
      id: 'song-b',
      title: { ko: 'Beta' },
      artist: { ko: 'Artist B' },
      youtubeVideoId: 'video-b',
      tags: ['event'],
      path: 'songs/song-b.json',
      status: 'published',
    },
    {
      id: 'song-c',
      title: { ko: 'Gamma' },
      artist: { ko: 'Artist C' },
      youtubeVideoId: 'video-c',
      tags: ['other'],
      path: 'songs/song-c.json',
      status: 'published',
    },
  ]

  return {
    data: {
      schemaVersion: 1,
      generatedAt: '2026-07-28T00:00:00.000Z',
      dataVersion,
      songs,
      eventRegistry: {
        event: {
          title: { ko: 'Event' },
        },
      },
    },
    source: 'cache',
    warning: '캐시를 사용 중입니다.',
  }
}

function catalogResultWithSongs(dataVersion: string, count: number): LoadResult<CallGuideManifest> {
  const result = catalogResult(dataVersion)
  result.data.songs = Array.from({ length: count }, (_, index) => ({
    artist: { ko: `Synthetic Artist ${index}` },
    id: `synthetic-song-${index}`,
    path: `songs/synthetic-song-${index}.json`,
    status: 'published' as const,
    tags: ['event'],
    title: { ko: `Synthetic ${index.toString().padStart(3, '0')} unique` },
    youtubeVideoId: `video${index.toString().padStart(6, '0')}`,
  }))
  return result
}

function renderedSongTitles(): string[] {
  return Array.from(document.querySelectorAll<HTMLHeadingElement>('.catalog-song-card h2'))
    .map((heading) => heading.textContent ?? '')
}

beforeEach(() => {
  harness.fetchCallGuideManifest.mockReset()
  harness.loadCallGuideRoute.mockClear()
  harness.prefetchCallGuideSong.mockClear()
  harness.intersectionObserverCreations = 0
  harness.songCardRenders.clear()
  vi.stubGlobal('IntersectionObserver', class {
    constructor() {
      harness.intersectionObserverCreations += 1
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CatalogPage randomized display order', () => {
  it('marks a manual retry busy and aborts its consumer when unmounted', async () => {
    let rejectRetry: (reason: unknown) => void = () => undefined
    const retry = new Promise<LoadResult<CallGuideManifest>>((_, reject) => {
      rejectRetry = reject
    })
    harness.fetchCallGuideManifest
      .mockRejectedValueOnce(new Error('initial unavailable'))
      .mockReturnValueOnce(retry)

    const view = render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>,
    )

    const retryButton = await screen.findByRole('button', { name: '다시 시도' })
    fireEvent.click(retryButton)

    expect(retryButton).toBeDisabled()
    expect(retryButton).toHaveAttribute('aria-busy', 'true')
    expect(view.container.querySelector('.catalog-content-layout')).toHaveAttribute('aria-busy', 'true')
    expect(harness.fetchCallGuideManifest).toHaveBeenCalledTimes(2)
    const retrySignal = harness.fetchCallGuideManifest.mock.calls[1]?.[1]?.signal as AbortSignal
    expect(retrySignal.aborted).toBe(false)

    view.unmount()
    expect(retrySignal.aborted).toBe(true)
    await act(async () => {
      rejectRetry(new DOMException('unmounted', 'AbortError'))
      await retry.catch(() => undefined)
    })
  })

  it('does not rerender retained memoized cards for query or same-version manifest updates', async () => {
    harness.fetchCallGuideManifest
      .mockResolvedValueOnce(catalogResultWithSongs('v1', 100))
      .mockResolvedValueOnce(catalogResultWithSongs('v1', 100))

    const view = render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(view.container.querySelectorAll('a.catalog-song-card')).toHaveLength(100))
    expect(
      Array.from(view.container.querySelectorAll<HTMLAnchorElement>('a.catalog-song-card'))
        .every((link) => link.tabIndex === 0),
    ).toBe(true)
    expect(view.container.querySelectorAll('.catalog-song-thumbnail')).toHaveLength(1)
    await waitFor(() => expect(harness.intersectionObserverCreations).toBe(1))
    expect(harness.songCardRenders.size).toBe(100)
    expect(Array.from(harness.songCardRenders.values()).every((count) => count === 1)).toBe(true)
    const retainedTitle = renderedSongTitles()[1]
    const retainedIndex = Number(/Synthetic (\d{3}) unique/.exec(retainedTitle)?.[1])
    const retainedId = `synthetic-song-${retainedIndex}`
    const otherIds = Array.from(harness.songCardRenders.keys()).filter((id) => id !== retainedId)

    fireEvent.change(screen.getByRole('textbox', { name: '곡 검색' }), {
      target: { value: retainedTitle },
    })
    expect(harness.songCardRenders.get(retainedId)).toBe(1)
    expect(view.container.querySelectorAll('a.catalog-song-card')).toHaveLength(1)

    fireEvent.change(screen.getByRole('textbox', { name: '곡 검색' }), {
      target: { value: '' },
    })
    expect(harness.songCardRenders.get(retainedId)).toBe(1)
    expect(otherIds.every((id) => harness.songCardRenders.get(id) === 2)).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(harness.fetchCallGuideManifest).toHaveBeenCalledTimes(2))
    expect(harness.songCardRenders.get(retainedId)).toBe(1)
    expect(otherIds.every((id) => harness.songCardRenders.get(id) === 2)).toBe(true)
  })

  it('keeps one order through filters and same-version retries, then reshuffles a new version', async () => {
    harness.fetchCallGuideManifest
      .mockResolvedValueOnce(catalogResult('v1'))
      .mockResolvedValueOnce(catalogResult('v1'))
      .mockResolvedValueOnce(catalogResult('v2'))

    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.999)
      .mockReturnValueOnce(0.999)

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(renderedSongTitles()).toEqual(['Beta', 'Gamma', 'Alpha']))

    fireEvent.change(screen.getByRole('textbox', { name: '곡 검색' }), {
      target: { value: 'Beta' },
    })
    expect(renderedSongTitles()).toEqual(['Beta'])

    fireEvent.change(screen.getByRole('textbox', { name: '곡 검색' }), {
      target: { value: '' },
    })
    expect(renderedSongTitles()).toEqual(['Beta', 'Gamma', 'Alpha'])

    fireEvent.click(screen.getByRole('button', { name: 'Events' }))
    fireEvent.click(screen.getByRole('button', { name: /Event.*2곡 수록/ }))
    expect(renderedSongTitles()).toEqual(['Beta', 'Alpha'])

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(harness.fetchCallGuideManifest).toHaveBeenCalledTimes(2))
    expect(renderedSongTitles()).toEqual(['Beta', 'Alpha'])
    expect(random).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(harness.fetchCallGuideManifest).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(renderedSongTitles()).toEqual(['Alpha', 'Beta']))
    expect(random).toHaveBeenCalledTimes(4)
  })

  it('coalesces hover, focus, and pointer-down prefetch for the same song', async () => {
    harness.fetchCallGuideManifest.mockResolvedValueOnce(catalogResult('v1'))

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>,
    )

    const alphaCard = await screen.findByRole('link', { name: /Alpha/ })
    vi.useFakeTimers()

    fireEvent.mouseEnter(alphaCard)
    vi.advanceTimersByTime(99)
    expect(harness.loadCallGuideRoute).not.toHaveBeenCalled()
    expect(harness.prefetchCallGuideSong).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(harness.loadCallGuideRoute).toHaveBeenCalledTimes(1)
    expect(harness.prefetchCallGuideSong).toHaveBeenCalledWith(
      'https://example.test/manifest.json',
      'song-a',
    )

    fireEvent.focus(alphaCard)
    expect(harness.loadCallGuideRoute).toHaveBeenCalledTimes(1)
    expect(harness.prefetchCallGuideSong).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(alphaCard)
    expect(harness.loadCallGuideRoute).toHaveBeenCalledTimes(1)
    expect(harness.prefetchCallGuideSong).toHaveBeenCalledTimes(1)
  })

  it('retries a failed prefetch and bounds completed song keys to five entries', async () => {
    const result = catalogResult('v1')
    result.data.songs = Array.from({ length: 6 }, (_, index) => ({
      artist: { ko: `Artist ${index}` },
      id: `song-${index}`,
      path: `songs/song-${index}.json`,
      status: 'published' as const,
      tags: ['event'],
      title: { ko: `Song ${index}` },
      youtubeVideoId: `video-id-${index}`,
    }))
    harness.fetchCallGuideManifest.mockResolvedValueOnce(result)
    harness.prefetchCallGuideSong.mockRejectedValueOnce(new Error('prefetch failed'))

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>,
    )

    const firstCard = await screen.findByRole('link', { name: /Song 0/ })
    await act(async () => {
      fireEvent.focus(firstCard)
      await Promise.resolve()
    })
    expect(harness.prefetchCallGuideSong).toHaveBeenCalledTimes(1)

    fireEvent.focus(firstCard)
    expect(harness.prefetchCallGuideSong).toHaveBeenCalledTimes(2)

    for (let index = 1; index < 6; index += 1) {
      fireEvent.focus(screen.getByRole('link', { name: new RegExp(`Song ${index}`) }))
    }
    expect(harness.prefetchCallGuideSong).toHaveBeenCalledTimes(7)

    fireEvent.focus(firstCard)
    expect(harness.prefetchCallGuideSong).toHaveBeenCalledTimes(8)
  })
})
