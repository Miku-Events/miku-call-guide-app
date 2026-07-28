import type { ChangeEvent, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CallGuideManifest, LoadResult } from '../data/types'

const harness = vi.hoisted(() => ({
  fetchCallGuideManifest: vi.fn(),
}))

vi.mock('../../app/config', () => ({
  getRootManifestUrl: () => 'https://example.test/manifest.json',
}))

vi.mock('../data/fetchManifest', () => ({
  fetchCallGuideManifest: harness.fetchCallGuideManifest,
}))

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
  Button: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button onClick={onClick} type="button">
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

function renderedSongTitles(): string[] {
  return Array.from(document.querySelectorAll<HTMLHeadingElement>('.catalog-song-card h2'))
    .map((heading) => heading.textContent ?? '')
}

beforeEach(() => {
  harness.fetchCallGuideManifest.mockReset()
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CatalogPage randomized display order', () => {
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
})
