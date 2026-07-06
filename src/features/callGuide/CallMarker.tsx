import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { arrowForCall, fallbackAnchorPercent, localizedText, normalizedCallKind } from './callPositioning'
import type { RenderableCall } from './callPositioning'

interface MarkerPosition {
  pointLeft: string
  pointTop?: string
  labelOffset?: string
  rangeSegments?: Array<{
    left: string
    top: string
    width: string
  }>
  endPoint?: {
    left: string
    top: string
  }
  pointArrow?: {
    left: string
    top: string
  }
}

interface CallMarkerProps {
  call: RenderableCall
  lineElement: HTMLElement | null
  graphemeCount: number
  callLanguage: string
  variant?: 'active' | 'preview'
  stackIndex?: number
}

interface PointMeasurement {
  anchorRect: DOMRect
  verticalRect: DOMRect
  anchorsAfterFinalGrapheme: boolean
}

function indexSelector(index: number): string {
  return `.grapheme[data-grapheme-index="${index}"]`
}

const rangeAboveClearancePx = 14
const rangeBelowClearancePx = 6
const endArrowAboveClearancePx = 18
const endArrowBelowClearancePx = 4
const pointArrowGapPx = 3
const pointArrowHeightPx = 16
const fallbackMarkerHeightPx = 24
const fallbackMarkerWidthPx = 96
const visibleGraphemeHeightThresholdPx = 1
const callMarkerStackStepPx = 24

function groupRangeRects(rects: DOMRect[]) {
  return rects.reduce<Array<{ top: number; bottom: number; left: number; right: number }>>((groups, rect) => {
    const group = groups.find((item) => Math.abs(item.top - rect.top) < 2)
    if (group) {
      group.top = Math.min(group.top, rect.top)
      group.bottom = Math.max(group.bottom, rect.bottom)
      group.left = Math.min(group.left, rect.left)
      group.right = Math.max(group.right, rect.right)
      return groups
    }

    groups.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
    return groups
  }, [])
}

function isVisibleGraphemeRect(rect: DOMRect): boolean {
  return rect.height > visibleGraphemeHeightThresholdPx
}

function nearestVisibleGraphemeRect(lineElement: HTMLElement, pointChar: number, anchorRect: DOMRect): DOMRect {
  const anchorCenterX = anchorRect.left + anchorRect.width / 2
  const anchorCenterY = anchorRect.top + anchorRect.height / 2
  const candidates = Array.from(lineElement.querySelectorAll<HTMLElement>('.grapheme'))
    .map((element) => ({
      index: Number(element.getAttribute('data-grapheme-index')),
      rect: element.getBoundingClientRect(),
    }))
    .filter((candidate) => Number.isFinite(candidate.index) && isVisibleGraphemeRect(candidate.rect))
    .sort((a, b) => {
      const aCenterX = a.rect.left + a.rect.width / 2
      const bCenterX = b.rect.left + b.rect.width / 2
      const aCenterY = a.rect.top + a.rect.height / 2
      const bCenterY = b.rect.top + b.rect.height / 2
      const verticalDistance = Math.abs(aCenterY - anchorCenterY) - Math.abs(bCenterY - anchorCenterY)
      const horizontalDistance = Math.abs(aCenterX - anchorCenterX) - Math.abs(bCenterX - anchorCenterX)
      const indexDistance = Math.abs(a.index - pointChar) - Math.abs(b.index - pointChar)

      return verticalDistance || horizontalDistance || indexDistance
    })

  return candidates[0]?.rect ?? anchorRect
}

function resolvePointMeasurement(lineElement: HTMLElement, pointChar: number, graphemeCount: number): PointMeasurement | null {
  const point = lineElement.querySelector<HTMLElement>(indexSelector(pointChar))
  if (point) {
    const anchorRect = point.getBoundingClientRect()

    // Check if it is a whitespace character that wrapped/collapsed in the browser
    if (point.textContent && /^\s+$/u.test(point.textContent)) {
      let prevIdx = pointChar - 1
      let prevPoint = null
      while (prevIdx >= 1) {
        const el = lineElement.querySelector<HTMLElement>(indexSelector(prevIdx))
        if (el && el.textContent && !/^\s+$/u.test(el.textContent)) {
          prevPoint = el
          break
        }
        prevIdx--
      }

      if (prevPoint) {
        const prevRect = prevPoint.getBoundingClientRect()
        // If the space's left is to the left of the preceding character's left,
        // it means the space wrapped or collapsed!
        if (anchorRect.left < prevRect.left) {
          return {
            anchorRect: prevRect,
            verticalRect: isVisibleGraphemeRect(prevRect)
              ? prevRect
              : nearestVisibleGraphemeRect(lineElement, prevIdx, prevRect),
            anchorsAfterFinalGrapheme: true,
          }
        }
      }
    }

    return {
      anchorRect,
      verticalRect: isVisibleGraphemeRect(anchorRect)
        ? anchorRect
        : nearestVisibleGraphemeRect(lineElement, pointChar, anchorRect),
      anchorsAfterFinalGrapheme: false,
    }
  }

  if (pointChar === graphemeCount + 1 && graphemeCount > 0) {
    const finalPoint = lineElement.querySelector<HTMLElement>(indexSelector(graphemeCount))
    if (!finalPoint) {
      return null
    }

    const anchorRect = finalPoint.getBoundingClientRect()
    return {
      anchorRect,
      verticalRect: isVisibleGraphemeRect(anchorRect)
        ? anchorRect
        : nearestVisibleGraphemeRect(lineElement, pointChar, anchorRect),
      anchorsAfterFinalGrapheme: true,
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

function railRangeTop(
  lane: RenderableCall['placement']['lane'],
  laneRect: DOMRect,
  targetRect: DOMRect,
  stackOffset: number,
): number {
  if (lane === 'above') {
    return Math.max(0, targetRect.top - laneRect.top - rangeAboveClearancePx - stackOffset)
  }

  return targetRect.bottom - laneRect.top + rangeBelowClearancePx + stackOffset
}

function railEndPointTop(
  lane: RenderableCall['placement']['lane'],
  laneRect: DOMRect,
  targetRect: DOMRect,
  stackOffset: number,
): number {
  if (lane === 'above') {
    return Math.max(0, targetRect.top - laneRect.top - endArrowAboveClearancePx - stackOffset)
  }

  return targetRect.bottom - laneRect.top + endArrowBelowClearancePx + stackOffset
}

function pointArrowTop(
  lane: RenderableCall['placement']['lane'],
  laneRect: DOMRect,
  targetRect: DOMRect,
  stackOffset: number,
  followsBelowTarget: boolean,
): number {
  if (lane === 'above') {
    return targetRect.top - laneRect.top - pointArrowHeightPx - pointArrowGapPx - stackOffset
  }

  if (!followsBelowTarget) {
    return pointArrowGapPx + stackOffset
  }

  return targetRect.bottom - laneRect.top + pointArrowGapPx + stackOffset
}

function pointMarkerTop(
  lane: RenderableCall['placement']['lane'],
  markerHeight: number,
  arrowTop: number,
): number {
  if (lane === 'above') {
    return arrowTop - markerHeight
  }

  return arrowTop + pointArrowHeightPx
}

export function CallMarker({
  call,
  lineElement,
  graphemeCount,
  callLanguage,
  variant = 'active',
  stackIndex = 0,
}: CallMarkerProps) {
  const markerRef = useRef<HTMLSpanElement | null>(null)
  const fallbackPercent = useMemo(
    () => fallbackAnchorPercent(call.anchor?.pointChar ?? 1, graphemeCount),
    [call.anchor?.pointChar, graphemeCount],
  )
  const [position, setPosition] = useState<MarkerPosition>({ pointLeft: `${fallbackPercent}%` })

  useLayoutEffect(() => {
    const markerElement = markerRef.current
    const anchor = call.anchor
    if (!lineElement || !markerElement || !anchor) {
      return
    }

    const update = () => {
      const lane = markerElement.parentElement
      const pointMeasurement = resolvePointMeasurement(lineElement, anchor.pointChar, graphemeCount)
      if (!lane || !pointMeasurement) {
        setPosition({ pointLeft: `${fallbackPercent}%` })
        return
      }

      const laneRect = lane.getBoundingClientRect()
      const markerRect = markerElement.getBoundingClientRect()
      const markerHeight = markerRect.height || fallbackMarkerHeightPx
      const markerWidth = markerRect.width || fallbackMarkerWidthPx
      const pointLeft =
        (pointMeasurement.anchorsAfterFinalGrapheme
          ? pointMeasurement.anchorRect.right
          : pointMeasurement.anchorRect.left + pointMeasurement.anchorRect.width / 2) - laneRect.left
      const labelOffset = labelOffsetForVisibleMarker(pointLeft, markerWidth, laneRect.width)
      const stackOffset = stackIndex * callMarkerStackStepPx
      const arrowTop = pointArrowTop(
        call.placement.lane,
        laneRect,
        pointMeasurement.verticalRect,
        stackOffset,
        true,
      )
      const pointTop = pointMarkerTop(call.placement.lane, markerHeight, arrowTop)
      const pointArrow = {
        left: `${pointLeft}px`,
        top: `${arrowTop}px`,
      }

      const startChar = anchor.rangeStartChar ?? anchor.pointChar
      const endChar = anchor.rangeEndChar ?? anchor.pointChar
      const start = lineElement.querySelector<HTMLElement>(indexSelector(startChar))
      const end = lineElement.querySelector<HTMLElement>(indexSelector(endChar))

      if (variant === 'active' && call.markers.range.enabled && start && end) {
        const endRect = end.getBoundingClientRect()
        const firstChar = Math.min(startChar, endChar)
        const lastChar = Math.max(startChar, endChar)
        const rangeRects = Array.from({ length: lastChar - firstChar + 1 }, (_, index) => firstChar + index)
          .map((charIndex) => lineElement.querySelector<HTMLElement>(indexSelector(charIndex))?.getBoundingClientRect())
          .filter((rect): rect is DOMRect => rect !== undefined && rect.height > 1)
        const rangeSegments = groupRangeRects(rangeRects).map((rect) => {
          const rangeTop = railRangeTop(call.placement.lane, laneRect, rect as DOMRect, stackOffset)
          return {
            left: `${rect.left - laneRect.left}px`,
            top: `${rangeTop}px`,
            width: `${Math.max(2, rect.right - rect.left)}px`,
          }
        })
        const endPointTop = railEndPointTop(call.placement.lane, laneRect, endRect, stackOffset)
        setPosition({
          pointLeft: `${pointLeft}px`,
          pointTop: `${pointTop}px`,
          labelOffset: `${labelOffset}px`,
          pointArrow,
          rangeSegments,
          endPoint:
            endChar !== anchor.pointChar
              ? {
                  left: `${endRect.left + endRect.width / 2 - laneRect.left}px`,
                  top: `${endPointTop}px`,
                }
              : undefined,
        })
        return
      }

      setPosition({ pointLeft: `${pointLeft}px`, pointTop: `${pointTop}px`, labelOffset: `${labelOffset}px`, pointArrow })
    }

    update()

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(lineElement)
    window.addEventListener('resize', update)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [call, fallbackPercent, graphemeCount, lineElement, stackIndex, variant])

  const direction = arrowForCall(call)
  const arrow = direction === 'down' ? '↓' : '↑'
  const callText = localizedText(call.text, callLanguage, ['ko', 'ja', 'romaji', 'en'])
  const callKind = normalizedCallKind(call)
  const showPointArrow = call.markers.point.enabled && call.markers.point.style !== 'none'
  const markerStyle = {
    left: position.pointLeft,
    top: position.pointTop,
    '--call-marker-label-offset': position.labelOffset ?? '0px',
  } as CSSProperties

  return (
    <>
      {call.markers.range.enabled && position.rangeSegments
        ? position.rangeSegments.map((segment, index) => (
        <span
          key={`${call.id}-range-${index}`}
          className="call-range"
          data-kind={callKind}
          data-intensity={call.cue.intensity}
          data-lane={call.placement.lane}
          data-style={call.markers.range.style}
          style={{ left: segment.left, top: segment.top, width: segment.width }}
          aria-hidden="true"
        />
          ))
        : null}
      {showPointArrow && position.pointArrow ? (
        <span
          className="call-arrow"
          data-kind={callKind}
          data-intensity={call.cue.intensity}
          data-lane={call.placement.lane}
          data-variant={variant}
          style={{ left: position.pointArrow.left, top: position.pointArrow.top }}
          aria-hidden="true"
        >
          {arrow}
        </span>
      ) : null}
      <span
        ref={markerRef}
        className="call-marker"
        data-kind={callKind}
        data-intensity={call.cue.intensity}
        data-lane={call.placement.lane}
        data-variant={variant}
        style={markerStyle}
      >
        <span className="call-marker-text">{callText}</span>
      </span>
      {variant === 'active' && position.endPoint ? (
        <span
          className="call-range-end-arrow"
          data-kind={callKind}
          data-intensity={call.cue.intensity}
          data-lane={call.placement.lane}
          style={{ left: position.endPoint.left, top: position.endPoint.top }}
          aria-hidden="true"
        >
          {arrow}
        </span>
      ) : null}
    </>
  )
}
