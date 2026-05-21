import { useCallback, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { LyricLine as LyricLineType } from '../data/types'
import { callKindPriority, localizedText, normalizedCallKind, splitGraphemeTokens } from './callPositioning'
import { CallMarker } from './CallMarker'
import type { GraphemeToken, RenderableCall, StreamingLyricPosition } from './callPositioning'

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

function renderLyricTokens(tokens: GraphemeToken[]) {
  const nodes: ReactNode[] = []

  tokens.forEach((token, tokenIndex) => {
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

    token.graphemes.forEach((grapheme) => {
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

export function LyricLine({
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

  const setLineRef = useCallback((element: HTMLElement | null) => {
    lineRef.current = element
    setLineElement(element)
    registerLine?.(element)
  }, [registerLine])

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
      {renderCallLane('above', aboveCalls)}
      <p className="lyric-original" aria-label={lyrics}>
        {renderLyricTokens(lyricTokens)}
      </p>
      <p className="lyric-pronunciation">{pronunciation}</p>
      {renderCallLane('below', belowCalls)}
    </article>
  )
}
