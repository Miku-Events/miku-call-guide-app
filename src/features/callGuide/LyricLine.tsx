import { memo, useCallback, useMemo, useRef, useState, useLayoutEffect, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { LyricLine as LyricLineType } from '../data/types'
import { callKindPriority, localizedText, normalizedCallKind, splitGraphemeTokens } from './callPositioning'
import { CallMarker } from './CallMarker'
import type { GraphemeToken, RenderableCall, StreamingLyricPosition } from './callPositioning'

interface RowSplit {
  startIdx: number
  endIdx: number
}

interface LyricLineProps {
  line: LyricLineType
  calls: RenderableCall[]
  active: boolean
  lyricsLanguage: string
  pronunciationLanguage: string
  callLanguage: string
  position: StreamingLyricPosition
  onSeek?: (line: LyricLineType) => void
  lineRef?: (element: HTMLElement | null) => void
}

const previewStackCollisionThresholdChars = 3

function callStackIndexes(calls: RenderableCall[]): number[] {
  const levels: number[] = []

  calls.forEach((call, index) => {
    const occupiedLevels = new Set<number>()

    calls.slice(0, index).forEach((previousCall, previousIndex) => {
      const distance = Math.abs(call.anchor.pointChar - previousCall.anchor.pointChar)
      if (distance <= previewStackCollisionThresholdChars) {
        occupiedLevels.add(levels[previousIndex] ?? 0)
      }
    })

    let nextLevel = 0
    while (occupiedLevels.has(nextLevel)) {
      nextLevel += 1
    }
    levels[index] = nextLevel
  })

  return levels
}

function orderedCallsForDisplay(calls: RenderableCall[]): RenderableCall[] {
  return [...calls].sort((a, b) => {
    const priority = callKindPriority[normalizedCallKind(a)] - callKindPriority[normalizedCallKind(b)]
    const anchor = a.anchor.pointChar - b.anchor.pointChar
    return priority || anchor || a.id.localeCompare(b.id)
  })
}

function isLineBreakGrapheme(value: string): boolean {
  return value === '\n' || value === '\r'
}


function renderLyricTokensForRow(tokens: GraphemeToken[], startIdx: number, endIdx: number) {
  const nodes: ReactNode[] = []

  tokens.forEach((token, tokenIndex) => {
    const rowGraphemes = token.graphemes.filter(
      (g) => g.index >= startIdx && g.index <= endIdx
    )

    if (rowGraphemes.length === 0) {
      return
    }

    let chunk: GraphemeToken['graphemes'] = []

    const flushChunk = () => {
      if (chunk.length === 0) {
        return
      }

      nodes.push(
        <span
          className="lyric-token"
          data-whitespace={token.isWhitespaceOnly}
          key={`${token.text}-${tokenIndex}-${chunk[0].index}`}
        >
          {chunk.map((grapheme) => (
            <span className="grapheme" data-grapheme-index={grapheme.index} key={`${grapheme.value}-${grapheme.index}`}>
              {grapheme.value}
            </span>
          ))}
        </span>,
      )
      chunk = []
    }

    rowGraphemes.forEach((grapheme) => {
      if (isLineBreakGrapheme(grapheme.value)) {
        flushChunk()
        nodes.push(
          <span
            aria-hidden="true"
            className="lyric-line-break"
            data-grapheme-index={grapheme.index}
            key={`line-break-${grapheme.index}`}
          />,
        )
        return
      }

      chunk.push(grapheme)
    })

    flushChunk()
  })

  return nodes
}

function LyricLineComponent({
  line,
  calls,
  active,
  lyricsLanguage,
  pronunciationLanguage,
  callLanguage,
  position,
  onSeek,
  lineRef: registerLine,
}: LyricLineProps) {
  const lineRef = useRef<HTMLElement | null>(null)
  const [lineElement, setLineElement] = useState<HTMLElement | null>(null)
  const lyrics = localizedText(line.text, lyricsLanguage, ['ja', 'ko', 'en'])
  const pronunciation = line.text[pronunciationLanguage] ?? ''
  const lyricTokens = useMemo(() => splitGraphemeTokens(lyrics), [lyrics])
  const graphemeCount = useMemo(
    () => lyricTokens.reduce((count, token) => count + token.graphemes.length, 0),
    [lyricTokens],
  )
  const aboveCalls = calls.filter((call) => call.placement.lane === 'above')
  const belowCalls = calls.filter((call) => call.placement.lane === 'below')
  const interactive = Boolean(onSeek)
  const markerVariant = active ? 'active' : 'preview'

  const [rowSplits, setRowSplits] = useState<RowSplit[] | null>(null)

  const setLineRef = useCallback((element: HTMLElement | null) => {
    lineRef.current = element
    setLineElement(element)
    registerLine?.(element)
  }, [registerLine])

  useLayoutEffect(() => {
    if (!lineElement || graphemeCount === 0) {
      setRowSplits(null)
      return
    }

    const updateSplits = () => {
      const graphemeElements = Array.from(lineElement.querySelectorAll<HTMLElement>('.grapheme'))
      if (graphemeElements.length === 0) {
        setRowSplits(null)
        return
      }

      const sortedElements = graphemeElements
        .map((el) => {
          const idxAttr = el.getAttribute('data-grapheme-index')
          return {
            element: el,
            index: idxAttr ? parseInt(idxAttr, 10) : -1,
          }
        })
        .filter((item) => item.index !== -1)
        .sort((a, b) => a.index - b.index)

      if (sortedElements.length === 0) {
        setRowSplits(null)
        return
      }

      const lineRect = lineElement.getBoundingClientRect()
      const splits: RowSplit[] = []
      let currentStart = sortedElements[0].index
      let lastTop = sortedElements[0].element.getBoundingClientRect().top - lineRect.top

      for (let i = 1; i < sortedElements.length; i++) {
        const item = sortedElements[i]
        const currentTop = item.element.getBoundingClientRect().top - lineRect.top
        
        if (Math.abs(currentTop - lastTop) > 6) {
          splits.push({
            startIdx: currentStart,
            endIdx: item.index - 1,
          })
          currentStart = item.index
          lastTop = currentTop
        }
      }

      splits.push({
        startIdx: currentStart,
        endIdx: graphemeCount,
      })

      setRowSplits((prev) => {
        if (!prev) return splits
        if (prev.length !== splits.length) return splits
        const hasDifference = prev.some((s, idx) => s.startIdx !== splits[idx].startIdx || s.endIdx !== splits[idx].endIdx)
        return hasDifference ? splits : prev
      })
    }

    updateSplits()

    const resizeObserver = new ResizeObserver(updateSplits)
    resizeObserver.observe(lineElement)
    window.addEventListener('resize', updateSplits)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateSplits)
    }
  }, [lineElement, graphemeCount])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive || (event.key !== 'Enter' && event.key !== ' ')) {
      return
    }

    event.preventDefault()
    onSeek?.(line)
  }

  const renderCallLane = (lane: 'above' | 'below', laneCalls: RenderableCall[]) => {
    if (laneCalls.length === 0) {
      return null
    }

    const orderedCalls = orderedCallsForDisplay(laneCalls)
    const stackIndexes = callStackIndexes(orderedCalls)
    const maxStackIndex = Math.max(0, ...stackIndexes)
    const laneStyle = {
      '--call-lane-extra-stack': `${maxStackIndex * 1.45}rem`,
    } as CSSProperties

    return (
      <div className="call-lane" data-lane={lane} aria-label={lane === 'above' ? '상단 콜' : '하단 콜'} style={laneStyle}>
        {orderedCalls.map((call, index) => (
          <CallMarker
            key={call.id}
            call={call}
            lineElement={lineElement}
            graphemeCount={graphemeCount}
            callLanguage={callLanguage}
            variant={markerVariant}
            stackIndex={stackIndexes[index] ?? 0}
          />
        ))}
      </div>
    )
  }

  const activeSplits = rowSplits || [{ startIdx: 1, endIdx: graphemeCount }]

  return (
    <article
      aria-current={active ? 'true' : undefined}
      className="lyric-line"
      data-active={active}
      data-has-below-calls={belowCalls.length > 0 ? 'true' : undefined}
      data-position={position}
      onClick={() => onSeek?.(line)}
      onKeyDown={handleKeyDown}
      ref={setLineRef}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {activeSplits.map((row, rowIdx) => {
        const isLastRow = rowIdx === activeSplits.length - 1
        const inRowRange = (charIdx: number) => {
          if (charIdx >= row.startIdx && charIdx <= row.endIdx) return true
          if (isLastRow && charIdx > row.endIdx) return true
          return false
        }

        const rowAboveCalls = aboveCalls.filter((call) => inRowRange(call.anchor.pointChar))
        const rowBelowCalls = belowCalls.filter((call) => inRowRange(call.anchor.pointChar))

        return (
          <div className="lyric-row-wrap" key={rowIdx}>
            {renderCallLane('above', rowAboveCalls)}
            <p className="lyric-original" aria-label={lyrics}>
              {renderLyricTokensForRow(lyricTokens, row.startIdx, row.endIdx)}
            </p>
            {renderCallLane('below', rowBelowCalls)}
          </div>
        )
      })}
      {pronunciation ? <p className="lyric-pronunciation">{pronunciation}</p> : null}
    </article>
  )
}

export const LyricLine = memo(LyricLineComponent, (prevProps, nextProps) => {
  return (
    prevProps.active === nextProps.active &&
    prevProps.position === nextProps.position &&
    prevProps.lyricsLanguage === nextProps.lyricsLanguage &&
    prevProps.pronunciationLanguage === nextProps.pronunciationLanguage &&
    prevProps.callLanguage === nextProps.callLanguage &&
    prevProps.calls === nextProps.calls &&
    prevProps.line.id === nextProps.line.id
  )
})

