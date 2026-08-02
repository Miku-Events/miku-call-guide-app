import { memo, useCallback, useMemo, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { localizedText } from '../../shared/i18n/localizedText'
import type { LyricLine as LyricLineType } from '../data/types'
import { CallMarker } from './CallMarker'
import {
  arrowForCall,
  splitGraphemeTokens,
  type GraphemeToken,
  type RenderableCall,
} from './callPositioning'
import {
  defaultRowSplits,
  laneKey,
  orderedCallsForDisplay,
  type LineLayout,
} from './lyricGeometry'

export type LyricLinePosition = 'current' | 'inactive'

interface LyricLineProps {
  line: LyricLineType
  calls: RenderableCall[]
  active: boolean
  detailed?: boolean
  layout?: LineLayout
  minBlockSize?: number
  lyricsLanguage: string
  pronunciationLanguage: string
  callLanguage: string
  position: LyricLinePosition
  onSeek?: (line: LyricLineType) => void
  lineRef?: (element: HTMLElement | null) => void
}


function isLineBreakGrapheme(value: string): boolean {
  return value === '\n' || value === '\r'
}

function renderLyricTokensForMeasure(tokens: GraphemeToken[]) {
  const nodes: ReactNode[] = []
  tokens.forEach((token, tokenIndex) => {
    let chunk: GraphemeToken['graphemes'] = []
    const flushChunk = () => {
      if (chunk.length === 0) {
        return
      }
      nodes.push(
        <span
          className="lyric-token-measure"
          data-measure-start={chunk[0].index}
          data-measure-end={chunk[chunk.length - 1].index}
          data-whitespace={token.isWhitespaceOnly}
          key={`measure-${token.text}-${tokenIndex}-${chunk[0].index}`}
        >
          {chunk.map((grapheme) => (
            <span
              className="grapheme-measure"
              data-grapheme-index-measure={grapheme.index}
              key={`measure-${grapheme.value}-${grapheme.index}`}
            >
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
            data-grapheme-index-measure={grapheme.index}
            key={`measure-line-break-${grapheme.index}`}
          />,
        )
      } else {
        chunk.push(grapheme)
      }
    })
    flushChunk()
  })
  return nodes
}

function renderLyricTokensForRow(tokens: GraphemeToken[], startIdx: number, endIdx: number) {
  const nodes: ReactNode[] = []
  tokens.forEach((token, tokenIndex) => {
    const rowGraphemes = token.graphemes.filter((item) => item.index >= startIdx && item.index <= endIdx)
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
      } else {
        chunk.push(grapheme)
      }
    })
    flushChunk()
  })
  return nodes
}

function LyricLineComponent({
  line,
  calls,
  active,
  detailed = true,
  layout,
  minBlockSize,
  lyricsLanguage,
  pronunciationLanguage,
  callLanguage,
  position,
  onSeek,
  lineRef,
}: LyricLineProps) {
  const lyrics = localizedText(line.text, lyricsLanguage, ['ja', 'ko', 'en'])
  const pronunciation = line.text[pronunciationLanguage] ?? ''
  const lyricTokens = useMemo(() => splitGraphemeTokens(lyrics), [lyrics])
  const graphemeCount = useMemo(
    () => lyricTokens.reduce((count, token) => count + token.graphemes.length, 0),
    [lyricTokens],
  )
  const aboveCalls = useMemo(() => calls.filter((call) => call.placement.lane === 'above'), [calls])
  const belowCalls = useMemo(() => calls.filter((call) => call.placement.lane === 'below'), [calls])
  const orderedCalls = useMemo(() => orderedCallsForDisplay(calls), [calls])
  const interactive = Boolean(onSeek)
  const markerVariant = active ? 'active' : 'preview'
  const rowSplits = layout?.rowSplits ?? defaultRowSplits(graphemeCount)
  const callTexts = orderedCalls.map((call) => localizedText(call.text, callLanguage, ['ko', 'ja', 'romaji', 'en']))
  const accessibleName = [lyrics, pronunciation, ...callTexts].filter(Boolean).join(' · ')
  const articleStyle = !detailed && minBlockSize
    ? ({ minBlockSize: `${minBlockSize}px` } as CSSProperties)
    : undefined

  const getCallRowIndexForRender = useCallback((pointChar: number) => {
    let rowIndex = rowSplits.findIndex((row) => pointChar >= row.startIdx && pointChar <= row.endIdx)
    if (rowIndex === -1) {
      rowIndex = Math.max(0, rowSplits.length - 1)
    }
    if (rowIndex > 0 && pointChar === rowSplits[rowIndex]?.startIdx) {
      const value = lyricTokens.flatMap((token) => token.graphemes).find((item) => item.index === pointChar)?.value
      if (value && /^\s+$/u.test(value)) {
        return rowIndex - 1
      }
    }
    return rowIndex
  }, [lyricTokens, rowSplits])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive || (event.key !== 'Enter' && event.key !== ' ')) {
      return
    }
    event.preventDefault()
    onSeek?.(line)
  }

  const renderCallLane = (lane: 'above' | 'below', laneCalls: readonly RenderableCall[], rowIndex: number) => {
    if (laneCalls.length === 0) {
      return null
    }
    const key = laneKey(rowIndex, lane)
    const laneStyle = {
      '--call-lane-extra-stack': `${layout?.laneExtraStack[key] ?? 0}px`,
    } as CSSProperties
    return (
      <div className="call-lane" data-lane={lane} aria-label={lane === 'above' ? '상단 콜' : '하단 콜'} style={laneStyle}>
        {orderedCallsForDisplay(laneCalls).map((call) => (
          <CallMarker
            key={call.id}
            call={call}
            graphemeCount={graphemeCount}
            callLanguage={callLanguage}
            layout={layout?.markerLayouts[call.id]}
            variant={markerVariant}
          />
        ))}
      </div>
    )
  }

  return (
    <article
      aria-current={active ? 'true' : undefined}
      aria-label={accessibleName}
      className="lyric-line"
      data-active={active}
      data-detailed={detailed ? 'true' : 'false'}
      data-grapheme-count={graphemeCount}
      data-has-below-calls={belowCalls.length > 0 ? 'true' : undefined}
      data-line-id={line.id}
      data-position={position}
      onClick={() => onSeek?.(line)}
      onKeyDown={handleKeyDown}
      ref={lineRef}
      role={interactive ? 'button' : undefined}
      style={articleStyle}
      tabIndex={interactive ? 0 : undefined}
    >
      {detailed ? (
        <div className="lyric-line-detail" aria-hidden="true">
          {rowSplits.map((row, rowIndex) => {
            const rowAboveCalls = aboveCalls.filter((call) => getCallRowIndexForRender(call.anchor.pointChar) === rowIndex)
            const rowBelowCalls = belowCalls.filter((call) => getCallRowIndexForRender(call.anchor.pointChar) === rowIndex)
            return (
              <div className="lyric-row-wrap" data-row-index={rowIndex} key={`${row.startIdx}-${row.endIdx}`}>
                {renderCallLane('above', rowAboveCalls, rowIndex)}
                <p className="lyric-original">{renderLyricTokensForRow(lyricTokens, row.startIdx, row.endIdx)}</p>
                {renderCallLane('below', rowBelowCalls, rowIndex)}
              </div>
            )
          })}
          <p className="lyric-original lyric-original-measure">
            {renderLyricTokensForMeasure(lyricTokens)}
          </p>
          {pronunciation ? <p className="lyric-pronunciation">{pronunciation}</p> : null}
        </div>
      ) : (
        <div className="lyric-line-fallback" aria-hidden="true">
          {orderedCalls.length > 0 ? (
            <div className="call-preview-row">
              {orderedCalls.map((call, index) => (
                <span className="call-preview-chip" data-lane={call.placement.lane} key={call.id}>
                  <span className="call-preview-arrow">{arrowForCall(call) === 'down' ? '↓' : '↑'}</span>
                  <span className="call-preview-text">{callTexts[index]}</span>
                </span>
              ))}
            </div>
          ) : null}
          <p className="lyric-original lyric-original-fallback">{lyrics}</p>
          {pronunciation ? <p className="lyric-pronunciation">{pronunciation}</p> : null}
        </div>
      )}
    </article>
  )
}

export const LyricLine = memo(LyricLineComponent, (previous, next) => (
  previous.active === next.active &&
  previous.position === next.position &&
  previous.detailed === next.detailed &&
  previous.layout === next.layout &&
  previous.minBlockSize === next.minBlockSize &&
  previous.lyricsLanguage === next.lyricsLanguage &&
  previous.pronunciationLanguage === next.pronunciationLanguage &&
  previous.callLanguage === next.callLanguage &&
  previous.calls === next.calls &&
  previous.line === next.line &&
  previous.onSeek === next.onSeek &&
  previous.lineRef === next.lineRef
))
