import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LyricLine as LyricLineType } from '../data/types'
import type { RenderableCall } from './callPositioning'
import { LyricLine } from './LyricLine'

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

describe('LyricLine', () => {
  it('renders above and below lyricTrack calls with automatic point arrows', () => {
    render(
      <LyricLine
        active
        callLanguage="ko"
        calls={[call('call-above', 'above', '하이!'), call('call-below', 'below', '오-!')]}
        line={line}
        lyricsLanguage="ja"
        position="current"
        pronunciationLanguage="koPronunciation"
      />,
    )

    expect(screen.getByLabelText('光るステージへ')).toBeInTheDocument()
    expect(screen.getByText('히카루 스테-지에')).toBeInTheDocument()
    expect(screen.getByText('하이!')).toBeInTheDocument()
    expect(screen.getByText('오-!')).toBeInTheDocument()
    expect(screen.getByText('↓')).toBeInTheDocument()
    expect(screen.getByText('↑')).toBeInTheDocument()
  })

  it('adds call kind attributes and stacks overlapping active calls by kind priority', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      const element = this as HTMLElement
      if (element.classList.contains('call-lane')) {
        return rect(0, 100, 360, 160)
      }
      if (element.classList.contains('call-marker')) {
        return rect(0, 0, 96, 24)
      }

      const graphemeIndex = element.getAttribute('data-grapheme-index')
      if (graphemeIndex) {
        return rect(120 + Number(graphemeIndex) * 10, 150, 10, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const penlightCall = call('call-penlight', 'above', '펜라이트', 'penlight')
    const chantCall = call('call-chant', 'above', '하이!', 'chant')
    penlightCall.anchor = { targetText: 'ja', unit: 'grapheme', pointChar: 3 }
    chantCall.anchor = { targetText: 'ja', unit: 'grapheme', pointChar: 3 }

    const { container, rerender } = render(
      <LyricLine
        active
        callLanguage="ko"
        calls={[penlightCall, chantCall]}
        line={line}
        lyricsLanguage="ja"
        position="current"
        pronunciationLanguage="koPronunciation"
      />,
    )
    rerender(
      <LyricLine
        active
        callLanguage="ko"
        calls={[{ ...penlightCall }, { ...chantCall }]}
        line={line}
        lyricsLanguage="ja"
        position="current"
        pronunciationLanguage="koPronunciation"
      />,
    )

    try {
      const markers = await waitFor(() => {
        const elements = Array.from(container.querySelectorAll<HTMLElement>('.call-marker[data-variant="active"]'))
        expect(elements).toHaveLength(2)
        expect(elements.every((element) => element.style.top.endsWith('px'))).toBe(true)
        return elements
      })

      expect(markers.map((marker) => marker.dataset.kind)).toEqual(['chant', 'penlight'])
      expect(markers.map((marker) => marker.dataset.intensity)).toEqual(['normal', 'normal'])
      expect(markers[0].style.top).not.toBe(markers[1].style.top)
      expect(Number.parseFloat(markers[0].style.top)).toBeGreaterThan(Number.parseFloat(markers[1].style.top))
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('wraps lyrics by word tokens while preserving grapheme anchors', () => {
    const wordLine: LyricLineType = {
      ...line,
      text: {
        ja: 'METEOR Future',
        koPronunciation: '메테오 퓨처',
      },
    }

    const { container } = render(
      <LyricLine
        active
        callLanguage="ko"
        calls={[]}
        line={wordLine}
        lyricsLanguage="ja"
        position="current"
        pronunciationLanguage="koPronunciation"
      />,
    )

    const tokenTexts = Array.from(container.querySelectorAll<HTMLElement>('.lyric-token')).map(
      (token) => token.textContent,
    )
    const graphemeIndexes = Array.from(container.querySelectorAll<HTMLElement>('.grapheme')).map((grapheme) =>
      grapheme.getAttribute('data-grapheme-index'),
    )

    expect(tokenTexts).toEqual(['METEOR ', 'Future'])
    expect(container.querySelectorAll('.lyric-original > .grapheme')).toHaveLength(0)
    expect(graphemeIndexes).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'])
  })

  it('renders inactive calls as anchored preview markers instead of leading preview chips', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.classList.contains('call-lane')) {
        return rect(0, 0, 240, 32)
      }

      if (this.classList.contains('call-marker')) {
        return rect(0, 0, 48, 18)
      }

      const graphemeIndex = Number(this.getAttribute('data-grapheme-index'))
      if (graphemeIndex > 0) {
        return rect((graphemeIndex - 1) * 12, 48, 12, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const { container, rerender } = render(
      <LyricLine
        active={false}
        callLanguage="ko"
        calls={[call('call-preview', 'above', '하이!')]}
        line={line}
        lyricsLanguage="ja"
        position="next"
        pronunciationLanguage="koPronunciation"
      />,
    )
    rerender(
      <LyricLine
        active={false}
        callLanguage="ko"
        calls={[call('call-preview', 'above', '하이!')]}
        line={line}
        lyricsLanguage="ja"
        position="next"
        pronunciationLanguage="koPronunciation"
      />,
    )

    try {
      expect(container.querySelector('.call-preview-chip')).toBeNull()
      const marker = await waitFor(() => {
        const element = container.querySelector<HTMLElement>('.call-marker[data-variant="preview"]')
        expect(element?.style.left).toBe('30px')
        return element!
      })
      expect(marker.style.top).toBe('11px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('does not vertically stack inactive preview markers when their anchors are separated', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.classList.contains('call-lane')) {
        return rect(0, 0, 240, 32)
      }

      if (this.classList.contains('call-marker')) {
        return rect(0, 0, 48, 18)
      }

      const graphemeIndex = Number(this.getAttribute('data-grapheme-index'))
      if (graphemeIndex > 0) {
        return rect((graphemeIndex - 1) * 12, 48, 12, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const firstCall = call('call-preview-first', 'above', '하이!')
    const secondCall = call('call-preview-second', 'above', '하이!')
    secondCall.anchor = {
      targetText: 'ja',
      unit: 'grapheme',
      pointChar: 8,
    }

    const { container, rerender } = render(
      <LyricLine
        active={false}
        callLanguage="ko"
        calls={[firstCall, secondCall]}
        line={line}
        lyricsLanguage="ja"
        position="next"
        pronunciationLanguage="koPronunciation"
      />,
    )
    rerender(
      <LyricLine
        active={false}
        callLanguage="ko"
        calls={[{ ...firstCall }, { ...secondCall }]}
        line={line}
        lyricsLanguage="ja"
        position="next"
        pronunciationLanguage="koPronunciation"
      />,
    )

    try {
      const markers = await waitFor(() => {
        const elements = Array.from(container.querySelectorAll<HTMLElement>('.call-marker[data-variant="preview"]'))
        expect(elements).toHaveLength(2)
        expect(elements.every((element) => element.style.top === '11px')).toBe(true)
        return elements
      })
      expect(markers[0].style.left).not.toBe(markers[1].style.left)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('renders a range end arrow and split bracket segments for a wrapped call range', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.classList.contains('call-lane')) {
        return rect(0, 0, 240, 32)
      }

      if (this.classList.contains('call-marker')) {
        return rect(0, 0, 24, 24)
      }

      const graphemeIndex = Number(this.getAttribute('data-grapheme-index'))
      if (graphemeIndex > 0) {
        const visualLine = graphemeIndex <= 5 ? 0 : 1
        const indexInLine = visualLine === 0 ? graphemeIndex - 1 : graphemeIndex - 6
        return rect(indexInLine * 12, 48 + visualLine * 32, 12, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const rangedCall = call('call-range', 'above', '하이!')
    rangedCall.anchor = {
      targetText: 'ja',
      unit: 'grapheme',
      pointChar: 3,
      rangeStartChar: 3,
      rangeEndChar: 7,
    }
    rangedCall.markers.range = { enabled: true, style: 'bracket' }

    const props = {
      active: true,
      callLanguage: 'ko',
      line,
      lyricsLanguage: 'ja',
      position: 'current' as const,
      pronunciationLanguage: 'koPronunciation',
    }
    const { container, rerender } = render(
      <LyricLine
        calls={[rangedCall]}
        {...props}
      />,
    )
    rerender(<LyricLine calls={[{ ...rangedCall }]} {...props} />)

    try {
      await waitFor(() => expect(container.querySelector('.call-range-end-arrow')).toBeInTheDocument())
      expect(container.querySelectorAll('.call-range')).toHaveLength(2)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('hides the point arrow when a segment disables it but keeps range markers', async () => {
    const noPointCall = call('call-no-point', 'above', '계속!')
    noPointCall.markers.point = { enabled: false, style: 'none', direction: 'auto' }
    noPointCall.markers.range = { enabled: true, style: 'bracket' }
    noPointCall.anchor = {
      targetText: 'ja',
      unit: 'grapheme',
      pointChar: 3,
      rangeStartChar: 3,
      rangeEndChar: 5,
    }

    const { container, rerender } = render(
      <LyricLine
        active
        callLanguage="ko"
        calls={[noPointCall]}
        line={line}
        lyricsLanguage="ja"
        position="current"
        pronunciationLanguage="koPronunciation"
      />,
    )
    rerender(
      <LyricLine
        active
        callLanguage="ko"
        calls={[{ ...noPointCall }]}
        line={line}
        lyricsLanguage="ja"
        position="current"
        pronunciationLanguage="koPronunciation"
      />,
    )

    await waitFor(() => expect(container.querySelector('.call-range-end-arrow')).toBeInTheDocument())
    expect(screen.getByText('계속!')).toBeInTheDocument()
    expect(container.querySelector('.call-arrow')).toBeNull()
  })

  it('anchors pointChar after the final grapheme to the wrapped line end', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.classList.contains('call-lane')) {
        return rect(0, 0, 240, 32)
      }

      if (this.classList.contains('call-marker')) {
        return rect(0, 0, 24, 24)
      }

      const graphemeIndex = Number(this.getAttribute('data-grapheme-index'))
      if (graphemeIndex > 0) {
        const visualLine = graphemeIndex <= 5 ? 0 : 1
        const indexInLine = visualLine === 0 ? graphemeIndex - 1 : graphemeIndex - 6
        return rect(indexInLine * 12, 48 + visualLine * 32, 12, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const endAnchorCall = call('call-end-anchor', 'above', '끝!')
    endAnchorCall.anchor = {
      targetText: 'ja',
      unit: 'grapheme',
      pointChar: 8,
    }

    const props = {
      active: true,
      callLanguage: 'ko',
      line,
      lyricsLanguage: 'ja',
      position: 'current' as const,
      pronunciationLanguage: 'koPronunciation',
    }
    const { container, rerender } = render(<LyricLine calls={[endAnchorCall]} {...props} />)
    rerender(<LyricLine calls={[{ ...endAnchorCall }]} {...props} />)

    try {
      const marker = await waitFor(() => {
        const element = container.querySelector<HTMLElement>('.call-marker')
        expect(element?.style.left).toBe('24px')
        return element!
      })
      const arrow = container.querySelector<HTMLElement>('.call-arrow')
      expect(marker.style.top).toBe('37px')
      expect(arrow?.style.left).toBe('24px')
      expect(arrow?.style.top).toBe('61px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('preserves explicit lyric line breaks before measuring call anchors', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.classList.contains('call-lane')) {
        return rect(0, 160, 240, 32)
      }

      if (this.classList.contains('call-marker')) {
        return rect(0, 0, 24, 24)
      }

      const graphemeIndex = Number(this.getAttribute('data-grapheme-index'))
      if (this.classList.contains('grapheme') && graphemeIndex > 0) {
        const visualLine = graphemeIndex <= 2 ? 0 : 1
        const indexInLine = visualLine === 0 ? graphemeIndex - 1 : graphemeIndex - 4
        return rect(indexInLine * 12, 48 + visualLine * 36, 12, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const twoLineLyric: LyricLineType = {
      ...line,
      text: {
        ja: 'そう\nHand in hand　君のその手は',
        koPronunciation: '소오\nHand in hand 키미노 소노 테와',
      },
    }
    const penlightCall = call('call-two-line-penlight', 'below', '오왼앞', 'penlight')
    penlightCall.anchor = {
      targetText: 'koPronunciation',
      unit: 'grapheme',
      pointChar: 4,
    }

    const props = {
      active: true,
      callLanguage: 'ko',
      line: twoLineLyric,
      lyricsLanguage: 'ja',
      position: 'current' as const,
      pronunciationLanguage: 'koPronunciation',
    }
    const { container, rerender } = render(<LyricLine calls={[penlightCall]} {...props} />)
    rerender(<LyricLine calls={[{ ...penlightCall }]} {...props} />)

    try {
      const marker = await waitFor(() => {
        const element = container.querySelector<HTMLElement>('.call-marker[data-kind="penlight"]')
        expect(element?.style.left).toBe('6px')
        return element!
      })
      const arrow = container.querySelector<HTMLElement>('.call-arrow')
      expect(container.querySelector('.lyric-line-break[data-grapheme-index="3"]')).toBeInTheDocument()
      expect(marker.style.top).toBe('-33px')
      expect(arrow?.style.left).toBe('6px')
      expect(arrow?.style.top).toBe('-49px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('uses the lyric anchor position for inactive below preview calls', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.classList.contains('call-lane')) {
        return rect(0, 160, 240, 32)
      }

      if (this.classList.contains('call-marker')) {
        return rect(0, 0, 24, 24)
      }

      const graphemeIndex = Number(this.getAttribute('data-grapheme-index'))
      if (this.classList.contains('grapheme') && graphemeIndex > 0) {
        const visualLine = graphemeIndex <= 2 ? 0 : 1
        const indexInLine = visualLine === 0 ? graphemeIndex - 1 : graphemeIndex - 4
        return rect(indexInLine * 12, 48 + visualLine * 36, 12, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const twoLineLyric: LyricLineType = {
      ...line,
      text: {
        ja: 'そう\nHand in hand　君のその手は',
        koPronunciation: '소오\nHand in hand 키미노 소노 테와',
      },
    }
    const penlightCall = call('call-inactive-two-line-penlight', 'below', '오왼앞', 'penlight')
    penlightCall.anchor = {
      targetText: 'koPronunciation',
      unit: 'grapheme',
      pointChar: 4,
    }

    const props = {
      active: false,
      callLanguage: 'ko',
      line: twoLineLyric,
      lyricsLanguage: 'ja',
      position: 'next' as const,
      pronunciationLanguage: 'koPronunciation',
    }
    const { container, rerender } = render(<LyricLine calls={[penlightCall]} {...props} />)
    rerender(<LyricLine calls={[{ ...penlightCall }]} {...props} />)

    try {
      const marker = await waitFor(() => {
        const element = container.querySelector<HTMLElement>('.call-marker[data-variant="preview"][data-kind="penlight"]')
        expect(element?.style.left).toBe('6px')
        return element!
      })
      const arrow = container.querySelector<HTMLElement>('.call-arrow[data-variant="preview"]')
      expect(marker.style.top).toBe('-33px')
      expect(arrow?.style.left).toBe('6px')
      expect(arrow?.style.top).toBe('-49px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('keeps a left-edge call marker inside the call lane', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.classList.contains('call-lane')) {
        return rect(0, 0, 240, 32)
      }

      if (this.classList.contains('call-marker')) {
        return rect(0, 0, 120, 24)
      }

      const graphemeIndex = Number(this.getAttribute('data-grapheme-index'))
      if (graphemeIndex > 0) {
        return rect((graphemeIndex - 1) * 12, 48, 12, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const leftEdgeCall = call('call-left-edge', 'above', '왼쪽 긴 콜 태그!')
    leftEdgeCall.anchor = {
      targetText: 'ja',
      unit: 'grapheme',
      pointChar: 1,
    }

    const props = {
      active: true,
      callLanguage: 'ko',
      line,
      lyricsLanguage: 'ja',
      position: 'current' as const,
      pronunciationLanguage: 'koPronunciation',
    }
    const { container, rerender } = render(<LyricLine calls={[leftEdgeCall]} {...props} />)
    rerender(<LyricLine calls={[{ ...leftEdgeCall }]} {...props} />)

    try {
      const marker = await waitFor(() => {
        const element = container.querySelector<HTMLElement>('.call-marker')
        expect(element?.style.left).toBe('6px')
        return element!
      })
      expect(marker.style.top).toBe('5px')
      expect(marker.style.getPropertyValue('--call-marker-label-offset')).toBe('54px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })

  it('uses a nearby visible glyph for vertical placement when the point anchor is a space', async () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRectMock() {
      if (this.classList.contains('call-lane')) {
        return rect(0, 0, 240, 32)
      }

      if (this.classList.contains('call-marker')) {
        return rect(0, 0, 48, 24)
      }

      const graphemeIndex = Number(this.getAttribute('data-grapheme-index'))
      if (graphemeIndex > 0) {
        if (graphemeIndex === 3) {
          return rect(24, 90, 8, 0)
        }

        const indexBeforeSpace = graphemeIndex < 3 ? graphemeIndex - 1 : graphemeIndex - 2
        return rect(indexBeforeSpace * 12, 48, 12, 24)
      }

      return originalGetBoundingClientRect.call(this)
    }

    const spaceAnchorCall = call('call-space-anchor', 'above', '하이!')
    spaceAnchorCall.anchor = {
      targetText: 'ja',
      unit: 'grapheme',
      pointChar: 3,
    }

    const props = {
      active: true,
      callLanguage: 'ko',
      line: lineWithSpace,
      lyricsLanguage: 'ja',
      position: 'current' as const,
      pronunciationLanguage: 'koPronunciation',
    }
    const { container, rerender } = render(<LyricLine calls={[spaceAnchorCall]} {...props} />)
    rerender(<LyricLine calls={[{ ...spaceAnchorCall }]} {...props} />)

    try {
      const marker = await waitFor(() => {
        const element = container.querySelector<HTMLElement>('.call-marker')
        expect(element?.style.left).toBe('28px')
        return element!
      })
      expect(marker.style.top).toBe('5px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
    }
  })
})
