import { LocateFixed } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { LyricLine as LyricLineType, SongGuide } from '../data/types'
import { callsForLine, findActiveLyric, type RenderableCall } from './callPositioning'
import { LyricLine } from './LyricLine'

interface LyricListProps {
  song: SongGuide
  currentMs: number
  onSeekToLine: (line: LyricLineType) => void
}

const dragThresholdPx = 6
const programmaticScrollTimeoutMs = 450

export function LyricList({ song, currentMs, onSeekToLine }: LyricListProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const lineElementsRef = useRef(new Map<string, HTMLElement>())
  const dragStateRef = useRef<{
    pointerId: number
    startY: number
    startScrollTop: number
    moved: boolean
  } | null>(null)
  const suppressClickRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const [dragging, setDragging] = useState(false)
  const activeLine = findActiveLyric(song.lyrics, currentMs)
  const activeIndex = useMemo(
    () => (activeLine ? song.lyrics.findIndex((line) => line.id === activeLine.id) : -1),
    [activeLine, song.lyrics],
  )

  const callsByLineId = useMemo(() => {
    const map = new Map<string, RenderableCall[]>()
    song.lyrics.forEach((line) => {
      map.set(line.id, callsForLine(song.callEvents, line.id))
    })
    return map
  }, [song.lyrics, song.callEvents])

  const clearProgrammaticScrollAfterAnimation = useCallback(() => {
    if (programmaticScrollTimerRef.current) {
      window.clearTimeout(programmaticScrollTimerRef.current)
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false
    }, programmaticScrollTimeoutMs)
  }, [])

  const scrollLineIntoListCenter = useCallback((lineId: string, behavior: ScrollBehavior = 'smooth') => {
    const listElement = listRef.current
    const lineElement = lineElementsRef.current.get(lineId)
    if (!listElement || !lineElement) {
      return
    }

    const listRect = listElement.getBoundingClientRect()
    const lineRect = lineElement.getBoundingClientRect()
    const lineTopInList = lineRect.top - listRect.top + listElement.scrollTop
    const targetTop = lineTopInList - listElement.clientHeight / 2 + lineRect.height / 2
    const maxScrollTop = Math.max(0, listElement.scrollHeight - listElement.clientHeight)
    const nextScrollTop = Math.min(Math.max(targetTop, 0), maxScrollTop)

    programmaticScrollRef.current = true
    listElement.scrollTo?.({ top: nextScrollTop, behavior })
    if (!listElement.scrollTo) {
      listElement.scrollTop = nextScrollTop
    }
    clearProgrammaticScrollAfterAnimation()
  }, [clearProgrammaticScrollAfterAnimation])

  useEffect(() => {
    if (!autoFollow || !activeLine) {
      return
    }

    scrollLineIntoListCenter(activeLine.id)
  }, [activeLine, autoFollow, scrollLineIntoListCenter])

  useEffect(() => () => {
    if (programmaticScrollTimerRef.current) {
      window.clearTimeout(programmaticScrollTimerRef.current)
    }
  }, [])

  const setManualExplore = () => {
    if (!programmaticScrollRef.current) {
      setAutoFollow(false)
    }
  }

  const setManualExploreFromWheel = () => {
    programmaticScrollRef.current = false
    setAutoFollow(false)
  }

  const registerLine = (lineId: string) => (element: HTMLElement | null) => {
    if (element) {
      lineElementsRef.current.set(lineId, element)
      return
    }

    lineElementsRef.current.delete(lineId)
  }

  const seekToLine = (line: LyricLineType) => {
    if (suppressClickRef.current) {
      return
    }

    setAutoFollow(true)
    scrollLineIntoListCenter(line.id)
    onSeekToLine(line)
  }

  const restoreAutoFollow = () => {
    setAutoFollow(true)
    if (activeLine) {
      scrollLineIntoListCenter(activeLine.id)
    }
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !listRef.current) {
      return
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: listRef.current.scrollTop,
      moved: false,
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    const listElement = listRef.current
    if (!dragState || !listElement || dragState.pointerId !== event.pointerId) {
      return
    }

    const deltaY = event.clientY - dragState.startY
    if (!dragState.moved && Math.abs(deltaY) >= dragThresholdPx) {
      dragState.moved = true
      suppressClickRef.current = true
      setDragging(true)
      setAutoFollow(false)
      if (!listElement.hasPointerCapture(event.pointerId)) {
        listElement.setPointerCapture(event.pointerId)
      }
    }

    if (dragState.moved) {
      event.preventDefault()
      listElement.scrollTop = dragState.startScrollTop - deltaY
    }
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (dragState?.pointerId === event.pointerId && listRef.current?.hasPointerCapture(event.pointerId)) {
      listRef.current.releasePointerCapture(event.pointerId)
    }

    dragStateRef.current = null
    setDragging(false)
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
  }

  return (
    <div className="lyric-list-shell" onWheel={setManualExploreFromWheel}>
      {!autoFollow ? (
        <button className="follow-active-button" onClick={restoreAutoFollow} type="button">
          <LocateFixed size={16} aria-hidden="true" />
          현재 가사
        </button>
      ) : null}
      <div
        aria-live="polite"
        className="lyric-list"
        data-dragging={dragging}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onScroll={setManualExplore}
        onWheel={setManualExploreFromWheel}
        ref={listRef}
      >
        {song.lyrics.map((line, index) => {
          const position = activeIndex === index ? 'current' : index < activeIndex ? 'previous' : 'next'

          return (
            <LyricLine
              key={line.id}
              line={line}
              active={activeLine?.id === line.id}
              calls={callsByLineId.get(line.id) ?? []}
              lyricsLanguage={song.display.defaultLyricsLanguage}
              pronunciationLanguage={song.display.defaultPronunciationLanguage}
              callLanguage={song.display.defaultCallLanguage}
              position={position}
              lineRef={registerLine(line.id)}
              onSeek={seekToLine}
            />
          )
        })}
      </div>

    </div>
  )
}
