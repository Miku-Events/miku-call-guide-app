import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SongGuide } from '../data/types'
import { createPlaybackTimeStore } from '../player/playbackTimeStore'
import { LyricList } from './LyricList'

const countdownProps = {
  countdownSchedule: [],
  playbackTimeStore: createPlaybackTimeStore(),
}

const song: SongGuide = {
  schemaVersion: 1,
  dataVersion: 'v1',
  id: 'sample-song',
  status: 'published',
  metadata: {
    title: { ko: '샘플' },
    artist: { ko: '샘플' },
    vocal: ['hatsune-miku'],
    tags: ['sample'],
  },
  youtube: { videoId: 'M7lc1UVf-VE', startOffsetMs: 0 },
  display: {
    defaultLyricsLanguage: 'ja',
    defaultPronunciationLanguage: 'koPronunciation',
    defaultCallLanguage: 'ko',
  },
  timing: { unit: 'ms', durationMs: 12000 },
  lyrics: [
    {
      id: 'line-001',
      startMs: 0,
      endMs: 6000,
      text: { ja: '光るステージへ', koPronunciation: '히카루 스테-지에' },
    },
    {
      id: 'line-002',
      startMs: 6000,
      endMs: 12000,
      text: { ja: '声を重ねよう', koPronunciation: '코에오 카사네요-' },
    },
  ],
  callEvents: [
    {
      id: 'call-001',
      lyricLineId: 'line-001',
      placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3 },
      text: { ko: '하이! 하이!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
      activation: { mode: 'lineActive' },
      cue: { kind: 'chant', intensity: 'normal', repeat: 2 },
    },
    {
      id: 'call-002',
      lyricLineId: 'line-002',
      placement: { mode: 'lyricTrack', lane: 'below', align: 'charAnchor' },
      anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 4 },
      text: { ko: '오-!' },
      markers: {
        point: { enabled: true, style: 'pointArrow', direction: 'auto' },
        range: { enabled: false, style: 'none' },
      },
      activation: { mode: 'lineActive' },
      cue: { kind: 'penlight', intensity: 'low', repeat: 1 },
    },
  ],
  notes: { author: '', source: '', reviewComment: '', copyrightNote: '' },
}

const segmentedSong: SongGuide = {
  ...song,
  callEvents: [
    {
      id: 'call-segment',
      placement: { mode: 'lyricTrack', lane: 'above', align: 'charAnchor' },
      text: { ko: '하이! 하이! 하이하이!' },
      activation: { mode: 'lineActive' },
      cue: { kind: 'chant', intensity: 'high', repeat: 1 },
      segments: [
        {
          lyricLineId: 'line-001',
          part: 'start',
          anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3, rangeStartChar: 3, rangeEndChar: 5 },
          markers: {
            point: { enabled: true, style: 'pointArrow', direction: 'auto' },
            range: { enabled: true, style: 'bracket' },
          },
        },
        {
          lyricLineId: 'line-002',
          part: 'end',
          anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 1, rangeStartChar: 1, rangeEndChar: 3 },
          markers: {
            point: { enabled: false, style: 'none', direction: 'auto' },
            range: { enabled: true, style: 'bracket' },
          },
        },
      ],
    },
  ],
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

describe('LyricList', () => {
  it('renders active call markers and inactive call previews', () => {
    const { container } = render(<LyricList {...countdownProps} activeLineId="line-001" onSeekToLine={vi.fn()} song={song} />)

    expect(screen.getByText('하이! 하이!')).toBeInTheDocument()
    expect(screen.getByText('오-!')).toBeInTheDocument()
    expect(container.querySelectorAll('.call-marker[data-variant="active"]')).toHaveLength(1)
    expect(container.querySelectorAll('.call-marker[data-variant="preview"]')).toHaveLength(1)
    expect(container.querySelectorAll('.call-preview-chip')).toHaveLength(0)
  })

  it('renders segmented calls as active markers and inactive previews per line', () => {
    const { container, rerender } = render(<LyricList {...countdownProps} activeLineId="line-001" onSeekToLine={vi.fn()} song={segmentedSong} />)

    expect(screen.getAllByText('하이! 하이! 하이하이!')).toHaveLength(2)
    expect(container.querySelectorAll('.call-marker[data-variant="active"]')).toHaveLength(1)
    expect(container.querySelectorAll('.call-marker[data-variant="preview"]')).toHaveLength(1)
    expect(container.querySelector('.lyric-line[data-active="true"] .call-marker[data-variant="preview"]')).toBeNull()

    rerender(<LyricList {...countdownProps} activeLineId="line-002" onSeekToLine={vi.fn()} song={segmentedSong} />)

    expect(container.querySelectorAll('.call-marker[data-variant="active"]')).toHaveLength(1)
    expect(container.querySelectorAll('.call-marker[data-variant="preview"]')).toHaveLength(1)
    expect(container.querySelector('.lyric-line[data-active="true"] .call-marker-text')?.textContent).toBe(
      '하이! 하이! 하이하이!',
    )
  })

  it('sends the clicked lyric line to the seek callback', () => {
    const onSeekToLine = vi.fn()
    render(<LyricList {...countdownProps} activeLineId="line-001" onSeekToLine={onSeekToLine} song={song} />)

    fireEvent.click(screen.getByRole('button', { name: /声を重ねよう/ }))

    expect(onSeekToLine).toHaveBeenCalledWith(expect.objectContaining({ id: 'line-002', startMs: 6000 }))
  })

  it('restores current lyric tracking when a lyric line is clicked', () => {
    const onSeekToLine = vi.fn()
    const { container } = render(<LyricList {...countdownProps} activeLineId="line-001" onSeekToLine={onSeekToLine} song={song} />)

    const lyricList = container.querySelector('.lyric-list')
    expect(lyricList).not.toBeNull()

    fireEvent.wheel(lyricList!)
    expect(screen.getByRole('button', { name: '현재 가사' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /声を重ねよう/ }))

    expect(screen.queryByRole('button', { name: '현재 가사' })).not.toBeInTheDocument()
    expect(onSeekToLine).toHaveBeenCalledWith(expect.objectContaining({ id: 'line-002', startMs: 6000 }))
  })

  it('cancels a pending distant-detail scroll when the user wheels the list', async () => {
    const originalIntersectionObserver = globalThis.IntersectionObserver
    const originalScrollTo = HTMLElement.prototype.scrollTo
    const scrollTo = vi.fn()

    class EmptyIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null
      readonly rootMargin: string
      readonly thresholds = [0]

      constructor(_callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.root = options?.root ?? null
        this.rootMargin = options?.rootMargin ?? '0px'
      }

      disconnect() {}
      observe() {}
      takeRecords() { return [] }
      unobserve() {}
    }

    globalThis.IntersectionObserver = EmptyIntersectionObserver
    HTMLElement.prototype.scrollTo = scrollTo

    try {
      const { container } = render(
        <LyricList {...countdownProps} activeLineId={null} onSeekToLine={vi.fn()} song={song} />,
      )
      const list = container.querySelector<HTMLElement>('.lyric-list')!
      const distantLine = screen.getByRole('button', { name: /声を重ねよう/ })
      expect(distantLine).toHaveAttribute('data-detailed', 'false')

      fireEvent.click(distantLine)
      fireEvent.wheel(list)
      for (let frame = 0; frame < 4; frame += 1) {
        await act(async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        })
      }

      expect(scrollTo).not.toHaveBeenCalled()
      expect(list).not.toHaveAttribute('data-programmatic-line-id')
      expect(screen.getByRole('button', { name: '현재 가사' })).toBeInTheDocument()
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver
      HTMLElement.prototype.scrollTo = originalScrollTo
    }
  })

  it('keeps auto-follow scrolling scoped to the lyric list element', async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const originalScrollTo = HTMLElement.prototype.scrollTo
    const scrollIntoView = vi.fn()
    const scrollTo = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    HTMLElement.prototype.scrollTo = scrollTo

    try {
      const { rerender } = render(<LyricList {...countdownProps} activeLineId="line-001" onSeekToLine={vi.fn()} song={song} />)

      rerender(<LyricList {...countdownProps} activeLineId="line-002" onSeekToLine={vi.fn()} song={song} />)

      expect(scrollIntoView).not.toHaveBeenCalled()
      await waitFor(() => expect(scrollTo).toHaveBeenCalled())
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      HTMLElement.prototype.scrollTo = originalScrollTo
    }
  })

  it('converges overlapping marker geometry after StrictMode cancels an intermediate frame', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('lyric-line')) return rect(0, 0, 360, 220)
      if (this.classList.contains('call-lane')) return rect(0, 100, 360, 120)
      if (this.classList.contains('call-marker')) return rect(0, 0, 96, 18)
      if (this.classList.contains('lyric-token-measure')) {
        const start = Number(this.dataset.measureStart)
        return rect((start - 1) * 24, 0, 48, 24)
      }
      const graphemeIndex = Number(this.dataset.graphemeIndex)
      if (graphemeIndex > 0) return rect((graphemeIndex - 1) * 24, 150, 12, 24)
      return originalRect.call(this)
    }
    const overlappingSong: SongGuide = {
      ...song,
      callEvents: [
        {
          ...song.callEvents[0],
          id: 'overlap-chant',
          text: { ko: '하이!' },
        },
        {
          ...song.callEvents[0],
          id: 'overlap-penlight',
          text: { ko: '펜라이트!' },
          cue: { kind: 'penlight', intensity: 'normal', repeat: 1 },
        },
      ],
    }

    try {
      const { container } = render(
        <StrictMode>
          <LyricList
            {...countdownProps}
            activeLineId="line-001"
            onSeekToLine={vi.fn()}
            song={overlappingSong}
          />
        </StrictMode>,
      )

      await waitFor(() => {
        const markers = Array.from(container.querySelectorAll<HTMLElement>('.call-marker[data-variant="active"]'))
        expect(markers).toHaveLength(2)
        expect(markers[0].style.top).not.toBe('')
        expect(markers[0].style.top).not.toBe(markers[1].style.top)
      })
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('keeps all 100 shells and tab stops while detailed DOM follows the observer window', async () => {
    const originalIntersectionObserver = globalThis.IntersectionObserver
    const originalResizeObserver = globalThis.ResizeObserver
    const originalAddEventListener = window.addEventListener
    const intersectionObservers: Array<{
      callback: IntersectionObserverCallback
      targets: Set<Element>
      rootMargin: string
    }> = []
    const resizeObservers: Array<{ targets: Set<Element> }> = []
    const resizeListeners: EventListenerOrEventListenerObject[] = []

    class IntersectionObserverHarness implements IntersectionObserver {
      readonly root: Element | Document | null
      readonly rootMargin: string
      readonly thresholds = [0]
      readonly targets = new Set<Element>()

      constructor(readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.root = options?.root ?? null
        this.rootMargin = options?.rootMargin ?? '0px'
        intersectionObservers.push({ callback, targets: this.targets, rootMargin: this.rootMargin })
      }

      disconnect() { this.targets.clear() }
      observe(target: Element) { this.targets.add(target) }
      takeRecords() { return [] }
      unobserve(target: Element) { this.targets.delete(target) }
    }

    class ResizeObserverHarness implements ResizeObserver {
      readonly targets = new Set<Element>()
      constructor() { resizeObservers.push({ targets: this.targets }) }
      disconnect() { this.targets.clear() }
      observe(target: Element) { this.targets.add(target) }
      unobserve(target: Element) { this.targets.delete(target) }
    }

    const longSong: SongGuide = {
      ...song,
      timing: { unit: 'ms', durationMs: 100_000 },
      lyrics: Array.from({ length: 100 }, (_, index) => ({
        id: `line-${String(index + 1).padStart(3, '0')}`,
        startMs: index * 1000,
        endMs: (index + 1) * 1000,
        text: { ja: `歌詞 ${index + 1}`, koPronunciation: `가사 ${index + 1}` },
      })),
      callEvents: [],
    }

    globalThis.IntersectionObserver = IntersectionObserverHarness
    globalThis.ResizeObserver = ResizeObserverHarness
    window.addEventListener = function addEventListener(type, listener, options) {
      if (type === 'resize') {
        resizeListeners.push(listener)
      }
      return originalAddEventListener.call(this, type, listener, options)
    }

    try {
      const { container } = render(
        <LyricList {...countdownProps} activeLineId="line-050" onSeekToLine={vi.fn()} song={longSong} />,
      )
      expect(container.querySelectorAll('.lyric-line')).toHaveLength(100)
      expect(container.querySelectorAll('.lyric-line[tabindex="0"]')).toHaveLength(100)
      expect(intersectionObservers).toHaveLength(1)
      expect(resizeObservers).toHaveLength(1)
      expect(intersectionObservers[0].rootMargin).toBe('480px 0px')

      const viewportTargets = [...intersectionObservers[0].targets].slice(0, 5)
      act(() => {
        intersectionObservers[0].callback(
          viewportTargets.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
          {} as IntersectionObserver,
        )
      })

      await waitFor(() => {
        expect(container.querySelectorAll('.lyric-line[data-detailed="true"]')).toHaveLength(6)
      })
      expect(container.querySelectorAll('.lyric-line[data-detailed="false"]')).toHaveLength(94)
      expect(resizeListeners).toHaveLength(0)

      const focusedShell = container.querySelector<HTMLElement>('.lyric-line[data-line-id="line-090"]')!
      fireEvent.focus(focusedShell)
      await waitFor(() => expect(focusedShell).toHaveAttribute('data-detailed', 'true'))

      const seekShell = container.querySelector<HTMLElement>('.lyric-line[data-line-id="line-080"]')!
      fireEvent.click(seekShell)
      await waitFor(() => expect(seekShell).toHaveAttribute('data-detailed', 'true'))
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver
      globalThis.ResizeObserver = originalResizeObserver
      window.addEventListener = originalAddEventListener
    }
  })
})
