import { callKindPriority, normalizedCallKind, type RenderableCall } from './callPositioning'

export interface CallMarkerLayout {
  pointLeft: number
  pointTop: number
  labelOffset: number
  pointArrow?: { left: number; top: number }
  rangeSegments?: Array<{ left: number; top: number; width: number }>
  endPoint?: { left: number; top: number }
}

export const callMarkerStackStepPx = 24

export interface RowSplit {
  startIdx: number
  endIdx: number
}

export interface LineLayout {
  rowSplits: RowSplit[]
  markerLayouts: Readonly<Record<string, CallMarkerLayout>>
  laneExtraStack: Readonly<Record<string, number>>
}

export interface DetailedLineGeometryRead {
  lineHeight: number
  graphemes: ReadonlyMap<number, { rect: RectValues; value: string }>
  lanes: ReadonlyMap<string, RectValues>
  markers: ReadonlyMap<string, RectValues>
}

interface RectValues {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

const callMarkerCollisionGapPx = 4
const callMarkerBoundsEpsilonPx = 0.25
const rowTopThresholdPx = 10
const rangeAboveClearancePx = 14
const rangeBelowClearancePx = 6
const endArrowAboveClearancePx = 18
const endArrowBelowClearancePx = 4
const pointArrowGapPx = 3
const pointArrowHeightPx = 16
const fallbackMarkerHeightPx = 24
const fallbackMarkerWidthPx = 96
const visibleGraphemeHeightThresholdPx = 1

function rectValues(rect: DOMRect): RectValues {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

export function laneKey(rowIndex: number, lane: 'above' | 'below'): string {
  return `${rowIndex}:${lane}`
}

export function defaultRowSplits(graphemeCount: number): RowSplit[] {
  return graphemeCount > 0 ? [{ startIdx: 1, endIdx: graphemeCount }] : []
}

export function rowSplitsEqual(left: readonly RowSplit[], right: readonly RowSplit[]): boolean {
  return (
    left.length === right.length &&
    left.every((split, index) =>
      split.startIdx === right[index]?.startIdx && split.endIdx === right[index]?.endIdx,
    )
  )
}

export function lineLayoutsEqual(previous: LineLayout | undefined, next: LineLayout): boolean {
  if (!previous || !rowSplitsEqual(previous.rowSplits, next.rowSplits)) {
    return false
  }

  const previousLaneKeys = Object.keys(previous.laneExtraStack)
  const nextLaneKeys = Object.keys(next.laneExtraStack)
  if (
    previousLaneKeys.length !== nextLaneKeys.length ||
    nextLaneKeys.some((key) => previous.laneExtraStack[key] !== next.laneExtraStack[key])
  ) {
    return false
  }

  const previousMarkerKeys = Object.keys(previous.markerLayouts)
  const nextMarkerKeys = Object.keys(next.markerLayouts)
  if (previousMarkerKeys.length !== nextMarkerKeys.length) {
    return false
  }

  const numbersEqual = (left: number | undefined, right: number | undefined) => {
    if (left === undefined || right === undefined) {
      return left === right
    }
    return Math.abs(left - right) < callMarkerBoundsEpsilonPx
  }

  return nextMarkerKeys.every((key) => {
    const left = previous.markerLayouts[key]
    const right = next.markerLayouts[key]
    if (!left || !right) {
      return left === right
    }
    if (
      !numbersEqual(left.pointLeft, right.pointLeft) ||
      !numbersEqual(left.pointTop, right.pointTop) ||
      !numbersEqual(left.labelOffset, right.labelOffset) ||
      !numbersEqual(left.pointArrow?.left, right.pointArrow?.left) ||
      !numbersEqual(left.pointArrow?.top, right.pointArrow?.top) ||
      !numbersEqual(left.endPoint?.left, right.endPoint?.left) ||
      !numbersEqual(left.endPoint?.top, right.endPoint?.top)
    ) {
      return false
    }

    const leftRanges = left.rangeSegments ?? []
    const rightRanges = right.rangeSegments ?? []
    return (
      leftRanges.length === rightRanges.length &&
      leftRanges.every((segment, index) => {
        const other = rightRanges[index]
        return (
          other !== undefined &&
          numbersEqual(segment.left, other.left) &&
          numbersEqual(segment.top, other.top) &&
          numbersEqual(segment.width, other.width)
        )
      })
    )
  })
}

export function measureLyricRowSplits(lineElement: HTMLElement, graphemeCount: number): RowSplit[] {
  if (graphemeCount === 0) {
    return []
  }

  const items = Array.from(
    lineElement.querySelectorAll<HTMLElement>(
      '.lyric-token-measure, .lyric-line-break[data-grapheme-index-measure]',
    ),
  )
  if (items.length === 0) {
    return defaultRowSplits(graphemeCount)
  }

  const splits: RowSplit[] = []
  let currentStart = 1
  let previousTop: number | null = null

  for (const item of items) {
    const explicitBreak = Number(item.dataset.graphemeIndexMeasure)
    if (Number.isFinite(explicitBreak) && explicitBreak >= currentStart) {
      splits.push({ startIdx: currentStart, endIdx: Math.min(explicitBreak, graphemeCount) })
      currentStart = explicitBreak + 1
      previousTop = null
      continue
    }

    const startIdx = Number(item.dataset.measureStart)
    if (!Number.isFinite(startIdx)) {
      continue
    }
    const currentTop = item.getBoundingClientRect().top
    if (
      previousTop !== null &&
      Math.abs(currentTop - previousTop) > rowTopThresholdPx &&
      startIdx > currentStart
    ) {
      splits.push({ startIdx: currentStart, endIdx: Math.min(startIdx - 1, graphemeCount) })
      currentStart = startIdx
    }
    previousTop = currentTop
  }

  if (currentStart <= graphemeCount) {
    splits.push({ startIdx: currentStart, endIdx: graphemeCount })
  }

  return splits.length > 0 ? splits : defaultRowSplits(graphemeCount)
}

/** Reads every geometry input for a line before any layout calculation occurs. */
export function readDetailedLineGeometry(lineElement: HTMLElement): DetailedLineGeometryRead {
  const graphemes = new Map<number, { rect: RectValues; value: string }>()
  for (const element of lineElement.querySelectorAll<HTMLElement>('.grapheme[data-grapheme-index]')) {
    const index = Number(element.dataset.graphemeIndex)
    if (Number.isFinite(index)) {
      graphemes.set(index, { rect: rectValues(element.getBoundingClientRect()), value: element.textContent ?? '' })
    }
  }

  const lanes = new Map<string, RectValues>()
  for (const element of lineElement.querySelectorAll<HTMLElement>('.call-lane[data-lane]')) {
    const rowElement = element.closest<HTMLElement>('.lyric-row-wrap[data-row-index]')
    const rowIndex = Number(rowElement?.dataset.rowIndex)
    const lane = element.dataset.lane
    if (Number.isFinite(rowIndex) && (lane === 'above' || lane === 'below')) {
      lanes.set(laneKey(rowIndex, lane), rectValues(element.getBoundingClientRect()))
    }
  }

  const markers = new Map<string, RectValues>()
  for (const element of lineElement.querySelectorAll<HTMLElement>('.call-marker[data-call-id]')) {
    const callId = element.dataset.callId
    if (callId) {
      markers.set(callId, rectValues(element.getBoundingClientRect()))
    }
  }

  return {
    lineHeight: lineElement.getBoundingClientRect().height,
    graphemes,
    lanes,
    markers,
  }
}

export function orderedCallsForDisplay(calls: readonly RenderableCall[]): RenderableCall[] {
  return [...calls].sort((a, b) => {
    const priority = callKindPriority[normalizedCallKind(a)] - callKindPriority[normalizedCallKind(b)]
    const anchor = a.anchor.pointChar - b.anchor.pointChar
    return priority || anchor || a.id.localeCompare(b.id)
  })
}

function getCallRowIndex(
  pointChar: number,
  rowSplits: readonly RowSplit[],
  graphemes: DetailedLineGeometryRead['graphemes'],
): number {
  let matched = rowSplits.findIndex((row) => pointChar >= row.startIdx && pointChar <= row.endIdx)
  if (matched === -1) {
    matched = Math.max(0, rowSplits.length - 1)
  }
  if (
    matched > 0 &&
    pointChar === rowSplits[matched]?.startIdx &&
    /^\s+$/u.test(graphemes.get(pointChar)?.value ?? '')
  ) {
    return matched - 1
  }
  return matched
}

function isVisibleRect(rect: RectValues): boolean {
  return rect.height > visibleGraphemeHeightThresholdPx
}

function nearestVisibleGraphemeRect(
  graphemes: DetailedLineGeometryRead['graphemes'],
  pointChar: number,
  anchorRect: RectValues,
): RectValues {
  const anchorCenterX = anchorRect.left + anchorRect.width / 2
  const anchorCenterY = anchorRect.top + anchorRect.height / 2
  return (
    [...graphemes.entries()]
      .filter(([, item]) => isVisibleRect(item.rect))
      .sort(([aIndex, a], [bIndex, b]) => {
        const aCenterX = a.rect.left + a.rect.width / 2
        const bCenterX = b.rect.left + b.rect.width / 2
        const aCenterY = a.rect.top + a.rect.height / 2
        const bCenterY = b.rect.top + b.rect.height / 2
        const verticalDistance = Math.abs(aCenterY - anchorCenterY) - Math.abs(bCenterY - anchorCenterY)
        const horizontalDistance = Math.abs(aCenterX - anchorCenterX) - Math.abs(bCenterX - anchorCenterX)
        const indexDistance = Math.abs(aIndex - pointChar) - Math.abs(bIndex - pointChar)
        return verticalDistance || horizontalDistance || indexDistance
      })[0]?.[1].rect ?? anchorRect
  )
}

function resolvePointMeasurement(
  graphemes: DetailedLineGeometryRead['graphemes'],
  pointChar: number,
  graphemeCount: number,
): { anchorRect: RectValues; verticalRect: RectValues; anchorsAfterFinalGrapheme: boolean } | null {
  const point = graphemes.get(pointChar)
  if (point) {
    if (/^\s+$/u.test(point.value)) {
      for (let previousIndex = pointChar - 1; previousIndex >= 1; previousIndex -= 1) {
        const previous = graphemes.get(previousIndex)
        if (previous && !/^\s+$/u.test(previous.value)) {
          if (point.rect.left < previous.rect.left) {
            return {
              anchorRect: previous.rect,
              verticalRect: isVisibleRect(previous.rect)
                ? previous.rect
                : nearestVisibleGraphemeRect(graphemes, previousIndex, previous.rect),
              anchorsAfterFinalGrapheme: true,
            }
          }
          break
        }
      }
    }

    return {
      anchorRect: point.rect,
      verticalRect: isVisibleRect(point.rect)
        ? point.rect
        : nearestVisibleGraphemeRect(graphemes, pointChar, point.rect),
      anchorsAfterFinalGrapheme: false,
    }
  }

  if (pointChar === graphemeCount + 1 && graphemeCount > 0) {
    const finalPoint = graphemes.get(graphemeCount)
    if (finalPoint) {
      return {
        anchorRect: finalPoint.rect,
        verticalRect: isVisibleRect(finalPoint.rect)
          ? finalPoint.rect
          : nearestVisibleGraphemeRect(graphemes, pointChar, finalPoint.rect),
        anchorsAfterFinalGrapheme: true,
      }
    }
  }
  return null
}

function labelOffsetForVisibleMarker(anchorLeft: number, markerWidth: number, laneWidth: number): number {
  if (laneWidth <= 0) {
    return 0
  }
  if (markerWidth >= laneWidth) {
    return laneWidth / 2 - anchorLeft
  }
  const halfMarkerWidth = markerWidth / 2
  const visibleCenter = Math.min(Math.max(anchorLeft, halfMarkerWidth), laneWidth - halfMarkerWidth)
  return visibleCenter - anchorLeft
}

function groupRangeRects(rects: RectValues[]) {
  return rects.reduce<Array<RectValues>>((groups, rect) => {
    const group = groups.find((item) => Math.abs(item.top - rect.top) < 2)
    if (group) {
      group.top = Math.min(group.top, rect.top)
      group.bottom = Math.max(group.bottom, rect.bottom)
      group.left = Math.min(group.left, rect.left)
      group.right = Math.max(group.right, rect.right)
      group.width = group.right - group.left
      group.height = group.bottom - group.top
    } else {
      groups.push({ ...rect })
    }
    return groups
  }, [])
}

function boundsOverlap(
  left: { left: number; right: number },
  right: { left: number; right: number },
): boolean {
  return (
    left.left < right.right + callMarkerCollisionGapPx &&
    left.right > right.left - callMarkerCollisionGapPx
  )
}

function rangeTop(lane: 'above' | 'below', laneRect: RectValues, targetRect: RectValues, stackOffset: number) {
  return lane === 'above'
    ? Math.max(0, targetRect.top - laneRect.top - rangeAboveClearancePx - stackOffset)
    : targetRect.bottom - laneRect.top + rangeBelowClearancePx + stackOffset
}

function endPointTop(lane: 'above' | 'below', laneRect: RectValues, targetRect: RectValues, stackOffset: number) {
  return lane === 'above'
    ? Math.max(0, targetRect.top - laneRect.top - endArrowAboveClearancePx - stackOffset)
    : targetRect.bottom - laneRect.top + endArrowBelowClearancePx + stackOffset
}

function arrowTop(lane: 'above' | 'below', laneRect: RectValues, targetRect: RectValues, stackOffset: number) {
  return lane === 'above'
    ? targetRect.top - laneRect.top - pointArrowHeightPx - pointArrowGapPx - stackOffset
    : targetRect.bottom - laneRect.top + pointArrowGapPx + stackOffset
}

/** Pure calculation over the list-level geometry read snapshot. */
export function calculateLineLayout(
  calls: readonly RenderableCall[],
  rowSplits: RowSplit[],
  graphemeCount: number,
  active: boolean,
  read: DetailedLineGeometryRead,
): LineLayout {
  const markerLayouts: Record<string, CallMarkerLayout> = {}
  const laneExtraStack: Record<string, number> = {}

  for (let rowIndex = 0; rowIndex < rowSplits.length; rowIndex += 1) {
    for (const lane of ['above', 'below'] as const) {
      const key = laneKey(rowIndex, lane)
      const laneRect = read.lanes.get(key)
      if (!laneRect) {
        continue
      }
      const laneCalls = orderedCallsForDisplay(
        calls.filter(
          (call) =>
            call.placement.lane === lane &&
            getCallRowIndex(call.anchor.pointChar, rowSplits, read.graphemes) === rowIndex,
        ),
      )

      const drafts = laneCalls.flatMap((call) => {
        const point = resolvePointMeasurement(read.graphemes, call.anchor.pointChar, graphemeCount)
        if (!point) {
          return []
        }
        const markerRect = read.markers.get(call.id)
        const markerWidth = markerRect?.width || fallbackMarkerWidthPx
        const markerHeight = markerRect?.height || fallbackMarkerHeightPx
        const pointLeft =
          (point.anchorsAfterFinalGrapheme
            ? point.anchorRect.right
            : point.anchorRect.left + point.anchorRect.width / 2) - laneRect.left
        const labelOffset = labelOffsetForVisibleMarker(pointLeft, markerWidth, laneRect.width)
        return [{
          call,
          point,
          pointLeft,
          labelOffset,
          markerHeight,
          bounds: {
            left: pointLeft - markerWidth / 2 + labelOffset,
            right: pointLeft + markerWidth / 2 + labelOffset,
          },
        }]
      })

      const occupiedByStack: Array<Array<{ left: number; right: number }>> = []
      const stackIndexes = drafts.map((draft) => {
        let stackIndex = 0
        while ((occupiedByStack[stackIndex] ?? []).some((bounds) => boundsOverlap(draft.bounds, bounds))) {
          stackIndex += 1
        }
        const occupied = occupiedByStack[stackIndex] ?? []
        occupied.push(draft.bounds)
        occupiedByStack[stackIndex] = occupied
        return stackIndex
      })
      laneExtraStack[key] = Math.max(0, ...stackIndexes) * callMarkerStackStepPx

      drafts.forEach((draft, index) => {
        const stackOffset = (stackIndexes[index] ?? 0) * callMarkerStackStepPx
        const pointArrowTop = arrowTop(lane, laneRect, draft.point.verticalRect, stackOffset)
        const pointTop = lane === 'above'
          ? pointArrowTop - draft.markerHeight
          : pointArrowTop + pointArrowHeightPx
        const markerLayout: CallMarkerLayout = {
          pointLeft: draft.pointLeft,
          pointTop,
          labelOffset: draft.labelOffset,
          pointArrow: {
            left: draft.pointLeft,
            top: pointArrowTop,
          },
        }

        const startChar = draft.call.anchor.rangeStartChar ?? draft.call.anchor.pointChar
        const endChar = draft.call.anchor.rangeEndChar ?? draft.call.anchor.pointChar
        const endRect = read.graphemes.get(endChar)?.rect
        if (active && draft.call.markers.range.enabled && endRect) {
          const firstChar = Math.min(startChar, endChar)
          const lastChar = Math.max(startChar, endChar)
          const rangeRects: RectValues[] = []
          for (let charIndex = firstChar; charIndex <= lastChar; charIndex += 1) {
            const rect = read.graphemes.get(charIndex)?.rect
            if (rect && isVisibleRect(rect)) {
              rangeRects.push(rect)
            }
          }
          markerLayout.rangeSegments = groupRangeRects(rangeRects).map((rect) => ({
            left: rect.left - laneRect.left,
            top: rangeTop(lane, laneRect, rect, stackOffset),
            width: Math.max(2, rect.right - rect.left),
          }))
          if (endChar !== draft.call.anchor.pointChar) {
            markerLayout.endPoint = {
              left: endRect.left + endRect.width / 2 - laneRect.left,
              top: endPointTop(lane, laneRect, endRect, stackOffset),
            }
          }
        }
        markerLayouts[draft.call.id] = markerLayout
      })
    }
  }

  return { rowSplits, markerLayouts, laneExtraStack }
}
