import { fireEvent, render, screen } from '@testing-library/react'
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

describe('LyricList', () => {
  it('renders active call markers and inactive call previews', () => {
    const { container } = render(<LyricList {...countdownProps} currentMs={1000} onSeekToLine={vi.fn()} song={song} />)

    expect(screen.getByText('하이! 하이!')).toBeInTheDocument()
    expect(screen.getByText('오-!')).toBeInTheDocument()
    expect(container.querySelectorAll('.call-marker[data-variant="active"]')).toHaveLength(1)
    expect(container.querySelectorAll('.call-marker[data-variant="preview"]')).toHaveLength(1)
    expect(container.querySelectorAll('.call-preview-chip')).toHaveLength(0)
  })

  it('renders segmented calls as active markers and inactive previews per line', () => {
    const { container, rerender } = render(<LyricList {...countdownProps} currentMs={1000} onSeekToLine={vi.fn()} song={segmentedSong} />)

    expect(screen.getAllByText('하이! 하이! 하이하이!')).toHaveLength(2)
    expect(container.querySelectorAll('.call-marker[data-variant="active"]')).toHaveLength(1)
    expect(container.querySelectorAll('.call-marker[data-variant="preview"]')).toHaveLength(1)
    expect(container.querySelector('.lyric-line[data-active="true"] .call-marker[data-variant="preview"]')).toBeNull()

    rerender(<LyricList {...countdownProps} currentMs={7000} onSeekToLine={vi.fn()} song={segmentedSong} />)

    expect(container.querySelectorAll('.call-marker[data-variant="active"]')).toHaveLength(1)
    expect(container.querySelectorAll('.call-marker[data-variant="preview"]')).toHaveLength(1)
    expect(container.querySelector('.lyric-line[data-active="true"] .call-marker-text')?.textContent).toBe(
      '하이! 하이! 하이하이!',
    )
  })

  it('sends the clicked lyric line to the seek callback', () => {
    const onSeekToLine = vi.fn()
    render(<LyricList {...countdownProps} currentMs={1000} onSeekToLine={onSeekToLine} song={song} />)

    fireEvent.click(screen.getByRole('button', { name: /声を重ねよう/ }))

    expect(onSeekToLine).toHaveBeenCalledWith(expect.objectContaining({ id: 'line-002', startMs: 6000 }))
  })

  it('restores current lyric tracking when a lyric line is clicked', () => {
    const onSeekToLine = vi.fn()
    const { container } = render(<LyricList {...countdownProps} currentMs={1000} onSeekToLine={onSeekToLine} song={song} />)

    const lyricList = container.querySelector('.lyric-list')
    expect(lyricList).not.toBeNull()

    fireEvent.wheel(lyricList!)
    expect(screen.getByRole('button', { name: '현재 가사' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /声を重ねよう/ }))

    expect(screen.queryByRole('button', { name: '현재 가사' })).not.toBeInTheDocument()
    expect(onSeekToLine).toHaveBeenCalledWith(expect.objectContaining({ id: 'line-002', startMs: 6000 }))
  })

  it('keeps auto-follow scrolling scoped to the lyric list element', () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const originalScrollTo = HTMLElement.prototype.scrollTo
    const scrollIntoView = vi.fn()
    const scrollTo = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    HTMLElement.prototype.scrollTo = scrollTo

    try {
      const { rerender } = render(<LyricList {...countdownProps} currentMs={1000} onSeekToLine={vi.fn()} song={song} />)

      rerender(<LyricList {...countdownProps} currentMs={7000} onSeekToLine={vi.fn()} song={song} />)

      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(scrollTo).toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      HTMLElement.prototype.scrollTo = originalScrollTo
    }
  })
})
