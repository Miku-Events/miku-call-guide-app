import type { CallAnchor, CallEvent, CallMarkers, CallSegment, LyricLine } from '../data/types'

export interface RenderableCall extends Omit<CallEvent, 'id' | 'lyricLineId' | 'anchor' | 'markers' | 'segments'> {
  id: string
  sourceCallId: string
  lyricLineId: string
  anchor: CallAnchor
  markers: CallMarkers
  segmentIndex?: number
  segmentPart?: CallSegment['part']
}

export type CallKind = CallEvent['cue']['kind']

export const callKindPriority: Record<CallKind, number> = {
  chant: 0,
  penlight: 1,
  custom: 2,
}

export const callKindLegend: Record<CallKind, { label: string }> = {
  chant: {
    label: 'Voice',
  },
  penlight: {
    label: 'Penlight',
  },
  custom: {
    label: 'Custom',
  },
}

export function normalizedCallKind(call: { cue?: { kind?: unknown } }): CallKind {
  return call.cue?.kind === 'chant' || call.cue?.kind === 'penlight' || call.cue?.kind === 'custom'
    ? call.cue.kind
    : 'custom'
}

export function callKindsInSong(callEvents: CallEvent[]): CallKind[] {
  return Array.from(new Set(callEvents.map((call) => normalizedCallKind(call)))).sort(
    (a, b) => callKindPriority[a] - callKindPriority[b],
  )
}

export function splitGraphemes(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(value), (part) => part.segment)
  }

  return Array.from(value)
}

export interface GraphemeToken {
  text: string
  isWhitespaceOnly: boolean
  graphemes: Array<{
    value: string
    index: number
  }>
}

function isWhitespaceGrapheme(value: string): boolean {
  return /^\s+$/u.test(value)
}

function splitFallbackWordSegments(value: string): string[] {
  const segments: string[] = []
  let current = ''
  let currentIsWhitespace: boolean | null = null

  splitGraphemes(value).forEach((grapheme) => {
    const isWhitespace = isWhitespaceGrapheme(grapheme)
    if (current && currentIsWhitespace !== isWhitespace) {
      segments.push(current)
      current = ''
    }

    current += grapheme
    currentIsWhitespace = isWhitespace
  })

  if (current) {
    segments.push(current)
  }

  return segments
}

function splitWordSegments(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
    return Array.from(segmenter.segment(value), (part) => part.segment)
  }

  return splitFallbackWordSegments(value)
}

export function splitGraphemeTokens(value: string): GraphemeToken[] {
  const tokens: GraphemeToken[] = []
  let nextIndex = 1
  let leadingWhitespaceText = ''
  let leadingWhitespaceGraphemes: GraphemeToken['graphemes'] = []

  splitWordSegments(value).forEach((segment) => {
    const graphemes = splitGraphemes(segment).map((grapheme) => ({
      value: grapheme,
      index: nextIndex++,
    }))
    if (graphemes.length === 0) {
      return
    }

    const isWhitespaceOnly = graphemes.every((grapheme) => isWhitespaceGrapheme(grapheme.value))
    if (isWhitespaceOnly) {
      if (tokens.length > 0) {
        const previousToken = tokens[tokens.length - 1]
        previousToken.text += segment
        previousToken.graphemes.push(...graphemes)
      } else {
        leadingWhitespaceText += segment
        leadingWhitespaceGraphemes = [...leadingWhitespaceGraphemes, ...graphemes]
      }
      return
    }

    tokens.push({
      text: `${leadingWhitespaceText}${segment}`,
      isWhitespaceOnly: false,
      graphemes: [...leadingWhitespaceGraphemes, ...graphemes],
    })
    leadingWhitespaceText = ''
    leadingWhitespaceGraphemes = []
  })

  if (leadingWhitespaceGraphemes.length > 0) {
    tokens.push({
      text: leadingWhitespaceText,
      isWhitespaceOnly: true,
      graphemes: leadingWhitespaceGraphemes,
    })
  }

  return tokens
}

export function findActiveLyric(lyrics: LyricLine[], currentMs: number): LyricLine | null {
  return lyrics.find((line) => line.startMs <= currentMs && currentMs < line.endMs) ?? null
}

export function visibleLyricWindow(
  lyrics: LyricLine[],
  activeLine: LyricLine | null,
  radius = 2,
): LyricLine[] {
  if (!activeLine) {
    return lyrics.slice(0, radius * 2 + 1)
  }

  const activeIndex = lyrics.findIndex((line) => line.id === activeLine.id)
  const start = Math.max(0, activeIndex - radius)
  const end = Math.min(lyrics.length, activeIndex + radius + 1)
  return lyrics.slice(start, end)
}

export type StreamingLyricPosition = 'previous' | 'current' | 'next'

export interface StreamingLyricItem {
  line: LyricLine
  position: StreamingLyricPosition
}

export function streamingLyricWindow(lyrics: LyricLine[], activeLine: LyricLine | null): StreamingLyricItem[] {
  if (lyrics.length === 0) {
    return []
  }

  const activeIndex = activeLine ? lyrics.findIndex((line) => line.id === activeLine.id) : 0
  const currentIndex = activeIndex >= 0 ? activeIndex : 0
  const items: StreamingLyricItem[] = []

  const previous = lyrics[currentIndex - 1]
  const current = lyrics[currentIndex]
  const next = lyrics[currentIndex + 1]

  if (previous) {
    items.push({ line: previous, position: 'previous' })
  }

  if (current) {
    items.push({ line: current, position: 'current' })
  }

  if (next) {
    items.push({ line: next, position: 'next' })
  }

  return items
}

export function callsForLine(callEvents: CallEvent[], lineId: string): RenderableCall[] {
  return callEvents.flatMap((call) => {
    if (call.placement.mode !== 'lyricTrack') {
      return []
    }

    if (call.segments?.length) {
      return call.segments.flatMap((segment, index) => {
        if (segment.lyricLineId !== lineId) {
          return []
        }

        return [
          {
            ...call,
            id: `${call.id}::segment-${index}`,
            sourceCallId: call.id,
            lyricLineId: segment.lyricLineId,
            anchor: segment.anchor,
            markers: segment.markers,
            segmentIndex: index,
            segmentPart: segment.part,
          },
        ]
      })
    }

    if (call.lyricLineId !== lineId || !call.anchor || !call.markers) {
      return []
    }

    return [
      {
        ...call,
        sourceCallId: call.id,
        lyricLineId: call.lyricLineId,
        anchor: call.anchor,
        markers: call.markers,
      },
    ]
  })
}

export function activeGlobalCalls(callEvents: CallEvent[], currentMs: number): CallEvent[] {
  return callEvents.filter(
    (call) =>
      call.placement.mode === 'globalTrack' &&
      typeof call.startMs === 'number' &&
      typeof call.endMs === 'number' &&
      call.startMs <= currentMs &&
      currentMs < call.endMs,
  )
}

export function localizedText(
  text: Record<string, string> | null | undefined,
  preferredKey: string,
  fallbackKeys: string[] = [],
): string {
  if (!text) {
    return ''
  }

  for (const key of [preferredKey, ...fallbackKeys]) {
    if (text[key]) {
      return text[key]
    }
  }

  return Object.values(text).find(Boolean) ?? ''
}

export function arrowForCall(call: { placement: CallEvent['placement']; markers: CallMarkers }): 'up' | 'down' {
  if (call.markers.point.direction === 'up' || call.markers.point.direction === 'down') {
    return call.markers.point.direction
  }

  return call.placement.lane === 'above' ? 'down' : 'up'
}

export function fallbackAnchorPercent(pointChar: number, graphemeCount: number): number {
  if (graphemeCount <= 0) {
    return 50
  }

  return ((Math.min(Math.max(pointChar, 1), graphemeCount) - 0.5) / graphemeCount) * 100
}
