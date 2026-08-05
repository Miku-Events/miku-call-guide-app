import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, type RenderResult } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LyricLine as LyricLineType } from '../data/types'
import type { RenderableCall } from './callPositioning'
import { LyricLine } from './LyricLine'
import {
  calculateLineLayout,
  lineLayoutsEqual,
  measureLyricRowSplits,
  readDetailedLineGeometry,
  type LineLayout,
} from './lyricGeometry'

const callGuideCss = readFileSync(
  join(process.cwd(), 'src', 'features', 'callGuide', 'callGuide.css'),
  'utf8',
)

const line: LyricLineType = {
  id: 'line-001',
  startMs: 0,
  endMs: 6000,
  text: {
    ja: '光るステージへ',
    koPronunciation: '히카루 스테-지에',
  },
}

const lineWithSpace: LyricLineType = {
  ...line,
  text: {
    ja: '嗚呼 日本の魂が',
    koPronunciation: '아아 닛폰 노 타마시이가',
  },
}

function call(
  id: string,
  lane: 'above' | 'below',
  text: string,
  kind: RenderableCall['cue']['kind'] = 'chant',
): RenderableCall {
  return {
    id,
    sourceCallId: id,
    lyricLineId: 'line-001',
    placement: { mode: 'lyricTrack', lane, align: 'charAnchor' },
    anchor: { targetText: 'ja', unit: 'grapheme', pointChar: 3 },
    text: { ko: text },
    markers: {
      point: { enabled: true, style: 'pointArrow', direction: 'auto' },
      range: { enabled: false, style: 'none' },
    },
    activation: { mode: 'lineActive' },
    cue: { kind, intensity: 'normal', repeat: 1 },
  }
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

interface ManagedLineProps {
  active?: boolean
  calls: RenderableCall[]
  line?: LyricLineType
}

function lineNode({ active = true, calls, line: lyric = line }: ManagedLineProps, layout?: LineLayout) {
  return (
    <LyricLine
      active={active}
      callLanguage="ko"
      calls={calls}
      detailed
      layout={layout}
      line={lyric}
      lyricsLanguage="ja"
      pronunciationLanguage="koPronunciation"
    />
  )
}

function calculateRenderedLayout(view: RenderResult, props: ManagedLineProps): LineLayout {
  const element = view.container.querySelector<HTMLElement>('.lyric-line')!
  const graphemeCount = Number(element.dataset.graphemeCount)
  const rowSplits = measureLyricRowSplits(element, graphemeCount)
  view.rerender(lineNode(props, { rowSplits, markerLayouts: {}, laneExtraStack: {} }))
  return calculateLineLayout(
    props.calls,
    rowSplits,
    graphemeCount,
    props.active ?? true,
    readDetailedLineGeometry(element),
  )
}

function renderMeasured(props: ManagedLineProps): RenderResult {
  const view = render(lineNode(props))
  view.rerender(lineNode(props, calculateRenderedLayout(view, props)))
  return view
}

function recompute(view: RenderResult, props: ManagedLineProps) {
  view.rerender(lineNode(props, calculateRenderedLayout(view, props)))
}

describe('LyricLine', () => {
  it('keeps measuring markers hidden but layout-measurable until geometry is ready', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    let measuredGeometryState: string | undefined
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 100, 360, 120)
      if (this.classList.contains('call-marker')) {
        measuredGeometryState = this.dataset.geometryState
        return rect(0, 0, 120, 18)
      }
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) return rect(index * 12, 150, 12, 24)
      return originalRect.call(this)
    }

    const measuringRule = callGuideCss.match(
      /\.call-marker\[data-geometry-state="measuring"\]\s*\{([^}]*)\}/,
    )?.[1]
    const readyRule = callGuideCss.match(
      /\.call-marker\[data-geometry-state="ready"\]\s*\{([^}]*)\}/,
    )?.[1]
    const props = { calls: [call('call-above', 'above', '하이 세노!')] }

    try {
      const view = render(lineNode(props))
      let marker = view.container.querySelector<HTMLElement>('.call-marker')!
      expect(marker).toHaveAttribute('data-geometry-state', 'measuring')
      expect(marker.style.left).toMatch(/%$/)
      expect(measuringRule).toContain('visibility: hidden')
      expect(measuringRule).not.toContain('display: none')

      const layout = calculateRenderedLayout(view, props)
      expect(measuredGeometryState).toBe('measuring')

      view.rerender(lineNode(props, layout))
      marker = view.container.querySelector<HTMLElement>('.call-marker')!
      expect(marker).toHaveAttribute('data-geometry-state', 'ready')
      expect(marker.style.left).toMatch(/px$/)
      expect(readyRule).toContain('visibility: visible')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('keeps one fixed accessible name while switching between fallback and detailed visuals', () => {
    const calls = [call('call-above', 'above', '하이!'), call('call-below', 'below', '오-!')]
    const onSeek = vi.fn()
    const { container, rerender } = render(
      <LyricLine
        active
        callLanguage="ko"
        calls={calls}
        detailed={false}
        line={line}
        lyricsLanguage="ja"
        onSeek={onSeek}
        pronunciationLanguage="koPronunciation"
      />,
    )

    const shell = screen.getByRole('button', { name: '光るステージへ · 히카루 스테-지에 · 하이! · 오-!' })
    expect(shell).toHaveAttribute('data-detailed', 'false')
    expect(container.querySelectorAll('.call-preview-chip')).toHaveLength(2)
    expect(container.querySelector('.grapheme')).toBeNull()

    rerender(
      <LyricLine
        active
        callLanguage="ko"
        calls={calls}
        detailed
        line={line}
        lyricsLanguage="ja"
        onSeek={onSeek}
        pronunciationLanguage="koPronunciation"
      />,
    )
    expect(screen.getByRole('button', { name: shell.getAttribute('aria-label')! })).toHaveAttribute('data-detailed', 'true')
    expect(container.querySelectorAll('.grapheme')).toHaveLength(7)
  })

  it('renders above and below calls with automatic point arrows from a supplied layout snapshot', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 100, 360, 120)
      if (this.classList.contains('call-marker')) return rect(0, 0, 48, 18)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) return rect(index * 12, 150, 12, 24)
      return originalRect.call(this)
    }
    try {
      const { container } = renderMeasured({
        calls: [call('call-above', 'above', '하이!'), call('call-below', 'below', '오-!')],
      })
      expect(screen.getByText('히카루 스테-지에')).toBeInTheDocument()
      expect(screen.getByText('하이!')).toBeInTheDocument()
      expect(screen.getByText('오-!')).toBeInTheDocument()
      expect(container.querySelectorAll('.call-arrow')).toHaveLength(2)
      expect(container.querySelector('.call-marker')?.getAttribute('style')).toContain('px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('wraps lyrics by word tokens while preserving every grapheme anchor', () => {
    const wordLine: LyricLineType = {
      ...line,
      text: { ja: 'METEOR Future', koPronunciation: '메테오 퓨처' },
    }
    const { container } = render(lineNode({ calls: [], line: wordLine }))
    expect(Array.from(container.querySelectorAll('.lyric-token')).map((token) => token.textContent)).toEqual([
      'METEOR ',
      'Future',
    ])
    expect(container.querySelectorAll('.grapheme')).toHaveLength(13)
  })

  it('stacks overlapping markers by call-kind priority and responds to measured chip width', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    let markerWidth = 48
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 100, 360, 120)
      if (this.classList.contains('call-marker')) return rect(0, 0, markerWidth, 18)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) return rect((index - 1) * 48, 150, 12, 24)
      return originalRect.call(this)
    }
    const first = call('call-penlight', 'above', '펜라이트', 'penlight')
    const second = call('call-chant', 'above', '하이!', 'chant')
    first.anchor.pointChar = 3
    second.anchor.pointChar = 5
    const props = { calls: [first, second] }
    try {
      const view = renderMeasured(props)
      let markers = Array.from(view.container.querySelectorAll<HTMLElement>('.call-marker'))
      expect(markers.map((marker) => marker.dataset.kind)).toEqual(['chant', 'penlight'])
      expect(markers[0].style.top).toBe(markers[1].style.top)

      markerWidth = 120
      recompute(view, props)
      markers = Array.from(view.container.querySelectorAll<HTMLElement>('.call-marker'))
      expect(markers[0].style.top).not.toBe(markers[1].style.top)

      markerWidth = 240
      recompute(view, props)
      markers = Array.from(view.container.querySelectorAll<HTMLElement>('.call-marker'))
      expect(markers[0].style.top).not.toBe(markers[1].style.top)

      markerWidth = 48
      recompute(view, props)
      markers = Array.from(view.container.querySelectorAll<HTMLElement>('.call-marker'))
      expect(markers[0].style.top).toBe(markers[1].style.top)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('does not stack inactive preview markers when measured bounds do not overlap', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 0, 480, 80)
      if (this.classList.contains('call-marker')) return rect(0, 0, 48, 18)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) return rect((index - 1) * 48, 48, 12, 24)
      return originalRect.call(this)
    }
    const first = call('first', 'above', '유쿠!')
    const second = call('second', 'above', '마데!')
    second.anchor.pointChar = 7
    try {
      const { container } = renderMeasured({ active: false, calls: [first, second] })
      const markers = Array.from(container.querySelectorAll<HTMLElement>('.call-marker[data-variant="preview"]'))
      expect(markers).toHaveLength(2)
      expect(markers[0].style.top).toBe(markers[1].style.top)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('renders split range rails and an end arrow across wrapped glyph rows', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 0, 240, 80)
      if (this.classList.contains('call-marker')) return rect(0, 0, 24, 24)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) {
        const row = index <= 5 ? 0 : 1
        return rect((row === 0 ? index - 1 : index - 6) * 12, 48 + row * 32, 12, 24)
      }
      return originalRect.call(this)
    }
    const ranged = call('range', 'above', '하이!')
    ranged.anchor = { targetText: 'ja', unit: 'grapheme', pointChar: 3, rangeStartChar: 3, rangeEndChar: 7 }
    ranged.markers.range = { enabled: true, style: 'bracket' }
    try {
      const { container } = renderMeasured({ calls: [ranged] })
      expect(container.querySelectorAll('.call-range')).toHaveLength(2)
      expect(container.querySelector('.call-range-end-arrow')).toBeInTheDocument()
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('keeps range markers while omitting a disabled point arrow', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 0, 240, 80)
      if (this.classList.contains('call-marker')) return rect(0, 0, 24, 24)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) return rect(index * 12, 48, 12, 24)
      return originalRect.call(this)
    }
    const ranged = call('no-point', 'above', '계속!')
    ranged.anchor = { targetText: 'ja', unit: 'grapheme', pointChar: 3, rangeStartChar: 3, rangeEndChar: 5 }
    ranged.markers.point = { enabled: false, style: 'none', direction: 'auto' }
    ranged.markers.range = { enabled: true, style: 'bracket' }
    try {
      const { container } = renderMeasured({ calls: [ranged] })
      expect(container.querySelector('.call-range')).toBeInTheDocument()
      expect(container.querySelector('.call-arrow')).toBeNull()
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('anchors pointChar after the final grapheme to the wrapped line end', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 0, 240, 80)
      if (this.classList.contains('call-marker')) return rect(0, 0, 24, 24)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) {
        const row = index <= 5 ? 0 : 1
        return rect((row === 0 ? index - 1 : index - 6) * 12, 48 + row * 32, 12, 24)
      }
      return originalRect.call(this)
    }
    const end = call('end', 'above', '끝!')
    end.anchor.pointChar = 8
    try {
      const { container } = renderMeasured({ calls: [end] })
      expect(container.querySelector<HTMLElement>('.call-marker')?.style.left).toBe('24px')
      expect(container.querySelector<HTMLElement>('.call-arrow')?.style.left).toBe('24px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('preserves explicit lyric breaks before assigning call rows', () => {
    const twoLine: LyricLineType = {
      ...line,
      text: { ja: 'そう\nHand in hand　君のその手は', koPronunciation: '소오\nHand in hand 키미노 소노 테와' },
    }
    const view = render(lineNode({ calls: [], line: twoLine }))
    const element = view.container.querySelector<HTMLElement>('.lyric-line')!
    const splits = measureLyricRowSplits(element, Number(element.dataset.graphemeCount))
    expect(splits).toHaveLength(2)
    view.rerender(lineNode({ calls: [], line: twoLine }, { rowSplits: splits, markerLayouts: {}, laneExtraStack: {} }))
    expect(view.container.querySelector('.lyric-line-break[data-grapheme-index="3"]')).toBeInTheDocument()
    expect(view.container.querySelectorAll('.lyric-row-wrap')).toHaveLength(2)
  })

  it('uses lyric geometry for an inactive below preview call', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 160, 240, 80)
      if (this.classList.contains('call-marker')) return rect(0, 0, 24, 24)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) return rect((index - 1) * 12, 84, 12, 24)
      return originalRect.call(this)
    }
    const below = call('below-preview', 'below', '오왼앞', 'penlight')
    below.anchor.pointChar = 4
    try {
      const { container } = renderMeasured({ active: false, calls: [below] })
      const marker = container.querySelector<HTMLElement>('.call-marker[data-variant="preview"]')!
      expect(marker.style.left).toBe('42px')
      expect(marker.style.top.endsWith('px')).toBe(true)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('clamps 48px, 120px, and 240px marker widths at the left lane boundary', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    let markerWidth = 48
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 0, 240, 80)
      if (this.classList.contains('call-marker')) return rect(0, 0, markerWidth, 24)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index > 0) return rect((index - 1) * 12, 48, 12, 24)
      return originalRect.call(this)
    }
    const left = call('left', 'above', '왼쪽 긴 콜 태그!')
    left.anchor.pointChar = 1
    try {
      const props = { calls: [left] }
      const view = renderMeasured(props)
      const expectedOffsets = new Map([[48, '18px'], [120, '54px'], [240, '114px']])

      for (const width of [48, 120, 240]) {
        markerWidth = width
        recompute(view, props)
        const marker = view.container.querySelector<HTMLElement>('.call-marker')!
        expect(marker.style.left).toBe('6px')
        expect(marker.style.getPropertyValue('--call-marker-label-offset')).toBe(expectedOffsets.get(width))
      }
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('uses a nearby visible glyph vertically when the point anchor has no height', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this.classList.contains('call-lane')) return rect(0, 0, 240, 80)
      if (this.classList.contains('call-marker')) return rect(0, 0, 48, 24)
      const index = Number(this.getAttribute('data-grapheme-index'))
      if (index === 3) return rect(24, 90, 8, 0)
      if (index > 0) return rect((index < 3 ? index - 1 : index - 2) * 12, 48, 12, 24)
      return originalRect.call(this)
    }
    const space = call('space', 'above', '하이!')
    space.anchor.pointChar = 3
    try {
      const { container } = renderMeasured({ calls: [space], line: lineWithSpace })
      const marker = container.querySelector<HTMLElement>('.call-marker')!
      expect(marker.style.left).toBe('28px')
      expect(marker.style.top).toBe('5px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('treats geometry deltas below 0.25px as the same immutable snapshot', () => {
    const base: LineLayout = {
      rowSplits: [{ startIdx: 1, endIdx: 2 }],
      laneExtraStack: { '0:above': 0 },
      markerLayouts: {
        call: { pointLeft: 10, pointTop: 20, labelOffset: 0, pointArrow: { left: 10, top: 30 } },
      },
    }
    expect(lineLayoutsEqual(base, {
      ...base,
      markerLayouts: {
        call: { pointLeft: 10.24, pointTop: 20.24, labelOffset: 0, pointArrow: { left: 10.24, top: 30.24 } },
      },
    })).toBe(true)
    expect(lineLayoutsEqual(base, {
      ...base,
      markerLayouts: {
        call: { pointLeft: 10.25, pointTop: 20, labelOffset: 0, pointArrow: { left: 10, top: 30 } },
      },
    })).toBe(false)
  })
})
