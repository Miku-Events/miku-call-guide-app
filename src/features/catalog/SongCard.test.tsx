import { cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogSongEntry } from './catalogModel'

const renderState = vi.hoisted(() => ({ arrowRenders: 0 }))

vi.mock('lucide-react', () => ({
  ArrowRight: () => {
    renderState.arrowRenders += 1
    return <svg aria-hidden="true" />
  },
}))

import { SongCard } from './SongCard'

function catalogEntry(id = 'song-a'): CatalogSongEntry {
  return {
    artist: 'Artist A',
    searchText: 'alpha artist a',
    song: {
      artist: { ko: 'Artist A' },
      id,
      path: `songs/${id}.json`,
      status: 'published',
      tags: ['event'],
      title: { ko: 'Alpha' },
      youtubeVideoId: 'video-id-01',
    },
    thumbnailUrl: 'https://i.ytimg.com/vi/video-id-01/hqdefault.jpg',
    title: 'Alpha',
    usesOriginalArtwork: false,
  }
}

afterEach(() => {
  cleanup()
  renderState.arrowRenders = 0
})

describe('SongCard', () => {
  it('keeps a memoized card out of unchanged parent renders', () => {
    const entry = catalogEntry()
    const observeThumbnail = vi.fn(() => vi.fn())
    const onCancelHoverPrefetch = vi.fn()
    const onImmediatePrefetch = vi.fn()
    const onScheduleHoverPrefetch = vi.fn()
    const props = {
      entry,
      isPriorityThumbnail: true,
      isThumbnailLoaded: false,
      observeThumbnail,
      onCancelHoverPrefetch,
      onImmediatePrefetch,
      onScheduleHoverPrefetch,
    }
    const view = render(<MemoryRouter><SongCard {...props} /></MemoryRouter>)

    expect(renderState.arrowRenders).toBe(1)
    view.rerender(<MemoryRouter><SongCard {...props} /></MemoryRouter>)
    expect(renderState.arrowRenders).toBe(1)

    view.rerender(
      <MemoryRouter>
        <SongCard {...props} entry={{ ...entry, title: 'Changed title' }} />
      </MemoryRouter>,
    )
    expect(renderState.arrowRenders).toBe(2)
  })

  it('loads the priority thumbnail eagerly and hides it directly after an error', () => {
    const view = render(
      <MemoryRouter>
        <SongCard
          entry={catalogEntry()}
          isPriorityThumbnail
          isThumbnailLoaded={false}
          observeThumbnail={vi.fn(() => vi.fn())}
          onCancelHoverPrefetch={vi.fn()}
          onImmediatePrefetch={vi.fn()}
          onScheduleHoverPrefetch={vi.fn()}
        />
      </MemoryRouter>,
    )

    const thumbnail = view.container.querySelector('.catalog-song-thumbnail') as HTMLImageElement
    expect(thumbnail).toHaveAttribute('src', 'https://i.ytimg.com/vi/video-id-01/hqdefault.jpg')
    expect(thumbnail).toHaveAttribute('loading', 'eager')
    expect(thumbnail).toHaveAttribute('fetchpriority', 'high')
    expect(thumbnail).toHaveAttribute('decoding', 'async')

    fireEvent.error(thumbnail)
    expect(thumbnail).toHaveStyle({ display: 'none' })
  })

  it('registers a non-priority thumbnail without assigning its source early', () => {
    const cleanupObservation = vi.fn()
    const observeThumbnail = vi.fn(() => cleanupObservation)
    const view = render(
      <MemoryRouter>
        <SongCard
          entry={catalogEntry()}
          isPriorityThumbnail={false}
          isThumbnailLoaded={false}
          observeThumbnail={observeThumbnail}
          onCancelHoverPrefetch={vi.fn()}
          onImmediatePrefetch={vi.fn()}
          onScheduleHoverPrefetch={vi.fn()}
        />
      </MemoryRouter>,
    )

    const media = view.container.querySelector('.catalog-song-media') as HTMLDivElement
    expect(view.container.querySelector('.catalog-song-thumbnail')).toBeNull()
    expect(observeThumbnail).toHaveBeenCalledWith(
      media,
      'song-a',
    )

    view.unmount()
    expect(cleanupObservation).toHaveBeenCalledTimes(1)
  })

  it('creates an intersected non-priority image with eager low-priority decoding', () => {
    const view = render(
      <MemoryRouter>
        <SongCard
          entry={catalogEntry()}
          isPriorityThumbnail={false}
          isThumbnailLoaded
          observeThumbnail={vi.fn(() => vi.fn())}
          onCancelHoverPrefetch={vi.fn()}
          onImmediatePrefetch={vi.fn()}
          onScheduleHoverPrefetch={vi.fn()}
        />
      </MemoryRouter>,
    )

    const thumbnail = view.container.querySelector('.catalog-song-thumbnail')
    expect(thumbnail).toHaveAttribute('src', 'https://i.ytimg.com/vi/video-id-01/hqdefault.jpg')
    expect(thumbnail).toHaveAttribute('loading', 'eager')
    expect(thumbnail).toHaveAttribute('fetchpriority', 'low')
    expect(thumbnail).toHaveAttribute('decoding', 'async')
  })
})
