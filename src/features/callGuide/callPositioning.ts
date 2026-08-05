import type { CallAnchor, CallEvent, CallMarkers, CallSegment } from '../data/types'

export { localizedText } from '../../shared/i18n/localizedText'

type DirectLyricCall = Extract<CallEvent, { anchor: unknown }>
type SegmentedLyricCall = Extract<CallEvent, { segments: unknown }>
type LyricCall = DirectLyricCall | SegmentedLyricCall

export interface RenderableCall {
  id: string
  sourceCallId: string
  lyricLineId: string
  placement: LyricCall['placement']
  anchor: CallAnchor
  text: LyricCall['text']
  markers: CallMarkers
  activation: LyricCall['activation']
  cue: LyricCall['cue']
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

function isDirectLyricCall(call: CallEvent): call is DirectLyricCall {
  return call.anchor !== undefined
}

function isSegmentedLyricCall(call: CallEvent): call is SegmentedLyricCall {
  return call.segments !== undefined
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

export function groupCallsByLineId(callEvents: readonly CallEvent[]): ReadonlyMap<string, RenderableCall[]> {
  const result = new Map<string, RenderableCall[]>()
  const append = (lineId: string, call: RenderableCall) => {
    const existing = result.get(lineId)
    if (existing) {
      existing.push(call)
    } else {
      result.set(lineId, [call])
    }
  }

  for (const call of callEvents) {
    if (call.placement.mode !== 'lyricTrack') {
      continue
    }

    if (isSegmentedLyricCall(call)) {
      call.segments.forEach((segment, index) => {
        append(segment.lyricLineId, {
          id: `${call.id}::segment-${index}`,
          sourceCallId: call.id,
          lyricLineId: segment.lyricLineId,
          placement: call.placement,
          anchor: segment.anchor,
          text: call.text,
          markers: segment.markers,
          activation: call.activation,
          cue: call.cue,
          segmentIndex: index,
          segmentPart: segment.part,
        })
      })
      continue
    }

    if (!isDirectLyricCall(call)) {
      continue
    }

    append(call.lyricLineId, {
      id: call.id,
      sourceCallId: call.id,
      lyricLineId: call.lyricLineId,
      placement: call.placement,
      anchor: call.anchor,
      text: call.text,
      markers: call.markers,
      activation: call.activation,
      cue: call.cue,
    })
  }

  return result
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
