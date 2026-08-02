import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LyricLine as LyricLineType, SongGuide } from '../data/types'
import { createPlaybackTimeStore } from '../player/playbackTimeStore'

const renderCounts = vi.hoisted(() => new Map<string, number>())

vi.mock('./LyricLine', async () => {
  const { createElement, memo } = await import('react')
  return { LyricLine: memo(function MockLyricLine({
    active,
    line,
    lineRef,
    position,
  }: {
    active: boolean
    line: LyricLineType
    lineRef?: (element: HTMLElement | null) => void
    position: 'current' | 'inactive'
  }) {
    renderCounts.set(line.id, (renderCounts.get(line.id) ?? 0) + 1)
    return createElement('article', {
      className: 'lyric-line',
      'data-active': active,
      'data-grapheme-count': 0,
      'data-line-id': line.id,
      'data-position': position,
      ref: lineRef,
    })
  }) }
})

import { LyricList } from './LyricList'

const song: SongGuide = {
  schemaVersion: 1,
  dataVersion: 'v1',
  id: 'render-count-song',
  status: 'published',
  metadata: {
    title: { ko: '렌더 테스트' },
    artist: { ko: '테스트' },
    vocal: ['hatsune-miku'],
    tags: ['test'],
  },
  youtube: { videoId: 'M7lc1UVf-VE', startOffsetMs: 0 },
  display: {
    defaultLyricsLanguage: 'ja',
    defaultPronunciationLanguage: 'koPronunciation',
    defaultCallLanguage: 'ko',
  },
  timing: { unit: 'ms', durationMs: 3000 },
  lyrics: Array.from({ length: 3 }, (_, index) => ({
    id: `line-${index + 1}`,
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    text: { ja: `歌詞 ${index + 1}`, koPronunciation: `가사 ${index + 1}` },
  })),
  callEvents: [],
  notes: { author: '', source: '', reviewComment: '', copyrightNote: '' },
}

async function settleFrames(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
  }
}

describe('LyricList render isolation', () => {
  it('does not rerender unrelated rows across current, gap, and next snapshots', async () => {
    const props = {
      countdownSchedule: [],
      onSeekToLine: vi.fn(),
      playbackTimeStore: createPlaybackTimeStore(),
      song,
    }
    const view = render(<LyricList {...props} activeLineId="line-1" />)
    await settleFrames()
    renderCounts.clear()

    view.rerender(<LyricList {...props} activeLineId={null} />)
    await settleFrames()
    expect(Object.fromEntries(renderCounts)).toEqual({ 'line-1': 1 })

    renderCounts.clear()
    view.rerender(<LyricList {...props} activeLineId="line-2" />)
    await settleFrames()
    expect(Object.fromEntries(renderCounts)).toEqual({ 'line-2': 1 })
  })
})
