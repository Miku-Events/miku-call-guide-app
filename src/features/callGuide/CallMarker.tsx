import type { CSSProperties } from 'react'
import { localizedText } from '../../shared/i18n/localizedText'
import { arrowForCall, fallbackAnchorPercent, normalizedCallKind } from './callPositioning'
import type { RenderableCall } from './callPositioning'

export interface CallMarkerLayout {
  pointLeft: number
  pointTop: number
  labelOffset: number
  pointArrow?: {
    left: number
    top: number
  }
  rangeSegments?: Array<{
    left: number
    top: number
    width: number
  }>
  endPoint?: {
    left: number
    top: number
  }
}

interface CallMarkerProps {
  call: RenderableCall
  graphemeCount: number
  callLanguage: string
  layout?: CallMarkerLayout
  variant?: 'active' | 'preview'
}

export const callMarkerStackStepPx = 24

/**
 * A marker is deliberately render-only. The lyric-list geometry coordinator
 * owns every DOM read and supplies one immutable layout snapshot per line.
 */
export function CallMarker({
  call,
  graphemeCount,
  callLanguage,
  layout,
  variant = 'active',
}: CallMarkerProps) {
  const direction = arrowForCall(call)
  const arrow = direction === 'down' ? '↓' : '↑'
  const callText = localizedText(call.text, callLanguage, ['ko', 'ja', 'romaji', 'en'])
  const callKind = normalizedCallKind(call)
  const showPointArrow = call.markers.point.enabled && call.markers.point.style !== 'none'
  const fallbackPercent = fallbackAnchorPercent(call.anchor?.pointChar ?? 1, graphemeCount)
  const geometryState = layout ? 'ready' : 'measuring'
  const markerStyle = {
    left: layout ? `${layout.pointLeft}px` : `${fallbackPercent}%`,
    top: layout ? `${layout.pointTop}px` : undefined,
    '--call-marker-label-offset': layout ? `${layout.labelOffset}px` : '0px',
  } as CSSProperties

  return (
    <>
      {variant === 'active' && call.markers.range.enabled && layout?.rangeSegments
        ? layout.rangeSegments.map((segment, index) => (
            <span
              key={`${call.id}-range-${index}`}
              className="call-range"
              data-kind={callKind}
              data-intensity={call.cue.intensity}
              data-lane={call.placement.lane}
              data-style={call.markers.range.style}
              style={{
                left: `${segment.left}px`,
                top: `${segment.top}px`,
                width: `${segment.width}px`,
              }}
              aria-hidden="true"
            />
          ))
        : null}
      {showPointArrow && layout?.pointArrow ? (
        <span
          className="call-arrow"
          data-kind={callKind}
          data-intensity={call.cue.intensity}
          data-lane={call.placement.lane}
          data-variant={variant}
          style={{ left: `${layout.pointArrow.left}px`, top: `${layout.pointArrow.top}px` }}
          aria-hidden="true"
        >
          {arrow}
        </span>
      ) : null}
      <span
        className="call-marker"
        data-call-id={call.id}
        data-geometry-state={geometryState}
        data-kind={callKind}
        data-intensity={call.cue.intensity}
        data-lane={call.placement.lane}
        data-variant={variant}
        style={markerStyle}
      >
        <span className="call-marker-text">{callText}</span>
      </span>
      {variant === 'active' && layout?.endPoint ? (
        <span
          className="call-range-end-arrow"
          data-kind={callKind}
          data-intensity={call.cue.intensity}
          data-lane={call.placement.lane}
          style={{ left: `${layout.endPoint.left}px`, top: `${layout.endPoint.top}px` }}
          aria-hidden="true"
        >
          {arrow}
        </span>
      ) : null}
    </>
  )
}
