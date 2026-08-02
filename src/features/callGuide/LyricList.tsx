import { Button } from '@astryxdesign/core/Button'
import { LocateFixed } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from 'react'
import { localizedText } from '../../shared/i18n/localizedText'
import type { LyricLine as LyricLineType, SongGuide } from '../data/types'
import type { PlaybackTimeStore } from '../player/playbackTimeStore'
import { callsForLine, type RenderableCall } from './callPositioning'
import { CountdownOverlay } from './CountdownOverlay'
import type { CountdownCue } from './countdownSchedule'
import { LyricLine } from './LyricLine'
import {
  calculateLineLayout,
  lineLayoutsEqual,
  measureLyricRowSplits,
  readDetailedLineGeometry,
  rowSplitsEqual,
  type LineLayout,
} from './lyricGeometry'

interface LyricListProps {
  song: SongGuide
  activeLineId: string | null
  onSeekToLine: (line: LyricLineType) => void
  countdownSchedule: readonly CountdownCue[]
  playbackTimeStore: PlaybackTimeStore
}

const dragThresholdPx = 6
const programmaticScrollTimeoutMs = 450
const minimumDetailOverscanPx = 480
const listWidthEpsilonPx = 1
const geometryEpsilonPx = 0.25

function closestLineId(target: EventTarget | null): string | null {
  return target instanceof Element
    ? target.closest<HTMLElement>('.lyric-line[data-line-id]')?.dataset.lineId ?? null
    : null
}

export function LyricList({
  song,
  activeLineId,
  onSeekToLine,
  countdownSchedule,
  playbackTimeStore,
}: LyricListProps) {
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
  const programmaticReleaseFrameRef = useRef<number | null>(null)
  const pendingDetailScrollFrameRef = useRef<number | null>(null)
  const scrollRequestTokenRef = useRef(0)
  const geometryFrameRef = useRef<number | null>(null)
  const intersectionFrameRef = useRef<number | null>(null)
  const geometryRunnerRef = useRef<() => void>(() => undefined)
  const detailedLineIdsRef = useRef<ReadonlySet<string>>(new Set())
  const activeLineIdRef = useRef<string | null>(activeLineId)
  const lineLayoutsRef = useRef(new Map<string, LineLayout>())
  const heightCacheRef = useRef(new Map<string, number>())
  const listWidthRef = useRef<number | null>(null)
  const listHeightRef = useRef<number | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeTargetsRef = useRef(new Set<Element>())
  const intersectionStateRef = useRef(new Set<string>())

  const [autoFollow, setAutoFollow] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [focusedLineId, setFocusedLineId] = useState<string | null>(null)
  const [programmaticLineId, setProgrammaticLineId] = useState<string | null>(null)
  const [intersectingLineIds, setIntersectingLineIds] = useState<ReadonlySet<string>>(() => new Set())
  const [lineLayouts, setLineLayouts] = useState<ReadonlyMap<string, LineLayout>>(() => new Map())
  const [cachedHeights, setCachedHeights] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [intersectionObserverVersion, setIntersectionObserverVersion] = useState(0)

  const lineById = useMemo(
    () => new Map(song.lyrics.map((line) => [line.id, line])),
    [song.lyrics],
  )
  const activeLine = activeLineId ? lineById.get(activeLineId) ?? null : null
  const lineRefCallbacks = useMemo(() => new Map(song.lyrics.map((line) => [
    line.id,
    (element: HTMLElement | null) => {
      if (element) {
        lineElementsRef.current.set(line.id, element)
      } else {
        lineElementsRef.current.delete(line.id)
      }
    },
  ])), [song.lyrics])

  const callsByLineId = useMemo(() => {
    const map = new Map<string, RenderableCall[]>()
    song.lyrics.forEach((line) => {
      map.set(line.id, callsForLine(song.callEvents, line.id))
    })
    return map
  }, [song.lyrics, song.callEvents])

  const detailedLineIds = useMemo(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return new Set(song.lyrics.map((line) => line.id))
    }

    const next = new Set(intersectingLineIds)
    if (activeLineId) {
      next.add(activeLineId)
    }
    if (focusedLineId) {
      next.add(focusedLineId)
    }
    if (programmaticLineId) {
      next.add(programmaticLineId)
    }
    return next
  }, [activeLineId, focusedLineId, intersectingLineIds, programmaticLineId, song.lyrics])

  const scheduleGeometry = useCallback(() => {
    if (geometryFrameRef.current !== null) {
      return
    }
    geometryFrameRef.current = window.requestAnimationFrame(() => {
      geometryFrameRef.current = null
      geometryRunnerRef.current()
    })
  }, [])

  const runGeometry = useCallback(() => {
    const detailIds = [...detailedLineIdsRef.current]
    const measuredSplits = new Map<string, ReturnType<typeof measureLyricRowSplits>>()
    let needsSplitCommit = false

    // Phase 1: read every natural row split before committing any line.
    detailIds.forEach((lineId) => {
      const element = lineElementsRef.current.get(lineId)
      if (!element) {
        return
      }
      const graphemeCount = Number(element.dataset.graphemeCount)
      const splits = measureLyricRowSplits(element, Number.isFinite(graphemeCount) ? graphemeCount : 0)
      measuredSplits.set(lineId, splits)
      const previous = lineLayoutsRef.current.get(lineId)
      if (!previous || !rowSplitsEqual(previous.rowSplits, splits)) {
        needsSplitCommit = true
      }
    })

    if (needsSplitCommit) {
      const nextLayouts = new Map(lineLayoutsRef.current)
      measuredSplits.forEach((rowSplits, lineId) => {
        const previous = nextLayouts.get(lineId)
        if (!previous || !rowSplitsEqual(previous.rowSplits, rowSplits)) {
          nextLayouts.set(lineId, { rowSplits, markerLayouts: {}, laneExtraStack: {} })
        }
      })
      lineLayoutsRef.current = nextLayouts
      setLineLayouts(nextLayouts)
      scheduleGeometry()
      return
    }

    // Phase 2: batch all DOM reads for detailed lines.
    const reads = detailIds.flatMap((lineId) => {
      const element = lineElementsRef.current.get(lineId)
      const rowSplits = measuredSplits.get(lineId)
      if (!element || !rowSplits) {
        return []
      }
      return [{ lineId, element, rowSplits, read: readDetailedLineGeometry(element) }]
    })

    // Phase 3: calculate collision stacks and final point/range geometry, then
    // commit each immutable line snapshot at most once.
    let layoutsChanged = false
    let heightsChanged = false
    const nextLayouts = new Map(lineLayoutsRef.current)
    reads.forEach(({ lineId, element, rowSplits, read }) => {
      const calls = callsByLineId.get(lineId) ?? []
      const graphemeCount = Number(element.dataset.graphemeCount)
      const next = calculateLineLayout(
        calls,
        rowSplits,
        Number.isFinite(graphemeCount) ? graphemeCount : 0,
        activeLineIdRef.current === lineId,
        read,
      )
      const previous = lineLayoutsRef.current.get(lineId)
      if (!lineLayoutsEqual(previous, next)) {
        nextLayouts.set(lineId, next)
        layoutsChanged = true
      }

      if (read.lineHeight > 0) {
        const previousHeight = heightCacheRef.current.get(lineId)
        if (previousHeight === undefined || Math.abs(previousHeight - read.lineHeight) >= geometryEpsilonPx) {
          heightCacheRef.current.set(lineId, read.lineHeight)
          heightsChanged = true
        }
      }
    })

    if (layoutsChanged) {
      lineLayoutsRef.current = nextLayouts
      setLineLayouts(nextLayouts)
    }
    if (heightsChanged) {
      setCachedHeights(new Map(heightCacheRef.current))
    }
  }, [callsByLineId, scheduleGeometry])

  useLayoutEffect(() => {
    detailedLineIdsRef.current = detailedLineIds
    activeLineIdRef.current = activeLineId
    geometryRunnerRef.current = runGeometry
    scheduleGeometry()
  }, [activeLineId, detailedLineIds, runGeometry, scheduleGeometry])

  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const listElement = listRef.current
      for (const entry of entries) {
        if (entry.target !== listElement) {
          continue
        }
        const width = entry.contentRect.width || listElement?.getBoundingClientRect().width || 0
        const height = entry.contentRect.height || listElement?.getBoundingClientRect().height || 0
        if (listWidthRef.current === null) {
          listWidthRef.current = width
        } else if (Math.abs(listWidthRef.current - width) >= listWidthEpsilonPx) {
          listWidthRef.current = width
          heightCacheRef.current.clear()
          setCachedHeights(new Map())
        }
        if (listHeightRef.current === null) {
          listHeightRef.current = height
        } else if (Math.abs(listHeightRef.current - height) >= listWidthEpsilonPx) {
          listHeightRef.current = height
          setIntersectionObserverVersion((version) => version + 1)
        }
      }
      scheduleGeometry()
    })
    resizeObserverRef.current = resizeObserver

    return () => {
      resizeObserver.disconnect()
      resizeObserverRef.current = null
      resizeTargetsRef.current.clear()
    }
  }, [scheduleGeometry])

  useLayoutEffect(() => {
    const observer = resizeObserverRef.current
    const listElement = listRef.current
    if (!observer || !listElement) {
      return
    }

    const nextTargets = new Set<Element>([listElement])
    detailedLineIds.forEach((lineId) => {
      const lineElement = lineElementsRef.current.get(lineId)
      if (!lineElement) {
        return
      }
      nextTargets.add(lineElement)
      lineElement.querySelectorAll('.call-marker').forEach((marker) => nextTargets.add(marker))
    })

    resizeTargetsRef.current.forEach((target) => {
      if (!nextTargets.has(target)) {
        observer.unobserve(target)
      }
    })
    nextTargets.forEach((target) => {
      if (!resizeTargetsRef.current.has(target)) {
        observer.observe(target)
      }
    })
    resizeTargetsRef.current = nextTargets
  }, [detailedLineIds, lineLayouts])

  useLayoutEffect(() => {
    const listElement = listRef.current
    if (!listElement || typeof IntersectionObserver === 'undefined') {
      return
    }

    intersectionStateRef.current = new Set()
    const overscan = Math.max(listElement.clientHeight, minimumDetailOverscanPx)
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const lineId = (entry.target as HTMLElement).dataset.lineId
        if (!lineId) {
          return
        }
        if (entry.isIntersecting) {
          intersectionStateRef.current.add(lineId)
        } else {
          intersectionStateRef.current.delete(lineId)
        }
      })

      if (intersectionFrameRef.current === null) {
        intersectionFrameRef.current = window.requestAnimationFrame(() => {
          intersectionFrameRef.current = null
          setIntersectingLineIds(new Set(intersectionStateRef.current))
        })
      }
    }, {
      root: listElement,
      rootMargin: `${overscan}px 0px`,
      threshold: 0,
    })

    lineElementsRef.current.forEach((element) => observer.observe(element))
    return () => {
      observer.disconnect()
      if (intersectionFrameRef.current !== null) {
        window.cancelAnimationFrame(intersectionFrameRef.current)
        intersectionFrameRef.current = null
      }
    }
  }, [intersectionObserverVersion, song.lyrics])

  useEffect(() => {
    const fonts = document.fonts
    if (!fonts) {
      return
    }
    fonts.addEventListener('loadingdone', scheduleGeometry)
    return () => fonts.removeEventListener('loadingdone', scheduleGeometry)
  }, [scheduleGeometry])

  useEffect(() => () => {
    scrollRequestTokenRef.current += 1
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current)
      programmaticScrollTimerRef.current = null
    }
    if (programmaticReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(programmaticReleaseFrameRef.current)
      programmaticReleaseFrameRef.current = null
    }
    if (pendingDetailScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingDetailScrollFrameRef.current)
      pendingDetailScrollFrameRef.current = null
    }
    if (geometryFrameRef.current !== null) {
      window.cancelAnimationFrame(geometryFrameRef.current)
      geometryFrameRef.current = null
    }
    if (intersectionFrameRef.current !== null) {
      window.cancelAnimationFrame(intersectionFrameRef.current)
      intersectionFrameRef.current = null
    }
  }, [])

  const centerLineInList = useCallback((lineId: string, behavior: ScrollBehavior): boolean => {
    const listElement = listRef.current
    const lineElement = lineElementsRef.current.get(lineId)
    if (!listElement || !lineElement) {
      return false
    }

    const listRect = listElement.getBoundingClientRect()
    const lineRect = lineElement.getBoundingClientRect()
    const lineTopInList = lineRect.top - listRect.top + listElement.scrollTop
    const targetTop = lineTopInList - listElement.clientHeight / 2 + lineRect.height / 2
    const maxScrollTop = Math.max(0, listElement.scrollHeight - listElement.clientHeight)
    const nextScrollTop = Math.min(Math.max(targetTop, 0), maxScrollTop)
    if (behavior === 'auto' && Math.abs(nextScrollTop - listElement.scrollTop) < geometryEpsilonPx) {
      return false
    }

    programmaticScrollRef.current = true
    if (behavior === 'auto') {
      listElement.scrollTop = nextScrollTop
    } else if (listElement.scrollTo) {
      listElement.scrollTo({ top: nextScrollTop, behavior })
    } else {
      listElement.scrollTop = nextScrollTop
    }
    return true
  }, [])

  const releaseProgrammaticScroll = useCallback(() => {
    if (programmaticReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(programmaticReleaseFrameRef.current)
    }
    programmaticReleaseFrameRef.current = window.requestAnimationFrame(() => {
      programmaticReleaseFrameRef.current = window.requestAnimationFrame(() => {
        programmaticReleaseFrameRef.current = null
        programmaticScrollRef.current = false
        setProgrammaticLineId(null)
      })
    })
  }, [setProgrammaticLineId])

  const cancelProgrammaticScroll = useCallback(() => {
    scrollRequestTokenRef.current += 1
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current)
      programmaticScrollTimerRef.current = null
    }
    if (programmaticReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(programmaticReleaseFrameRef.current)
      programmaticReleaseFrameRef.current = null
    }
    if (pendingDetailScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingDetailScrollFrameRef.current)
      pendingDetailScrollFrameRef.current = null
    }
    programmaticScrollRef.current = false
    setProgrammaticLineId(null)
  }, [setProgrammaticLineId])

  const clearProgrammaticScrollAfterAnimation = useCallback((lineId: string) => {
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current)
    }
    if (programmaticReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(programmaticReleaseFrameRef.current)
      programmaticReleaseFrameRef.current = null
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollTimerRef.current = null
      if (programmaticScrollRef.current) {
        centerLineInList(lineId, 'auto')
      }
      releaseProgrammaticScroll()
    }, programmaticScrollTimeoutMs)
  }, [centerLineInList, releaseProgrammaticScroll])

  const scrollLineIntoListCenter = useCallback((lineId: string, behavior: ScrollBehavior = 'smooth') => {
    scrollRequestTokenRef.current += 1
    const requestToken = scrollRequestTokenRef.current
    if (pendingDetailScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingDetailScrollFrameRef.current)
      pendingDetailScrollFrameRef.current = null
    }
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current)
      programmaticScrollTimerRef.current = null
    }
    if (programmaticReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(programmaticReleaseFrameRef.current)
      programmaticReleaseFrameRef.current = null
    }

    const performScroll = () => {
      if (scrollRequestTokenRef.current !== requestToken || !programmaticScrollRef.current) {
        return
      }
      pendingDetailScrollFrameRef.current = null
      centerLineInList(lineId, behavior)
      clearProgrammaticScrollAfterAnimation(lineId)
    }

    const waitForDetail = (framesRemaining: number) => {
      pendingDetailScrollFrameRef.current = window.requestAnimationFrame(() => {
        pendingDetailScrollFrameRef.current = null
        if (scrollRequestTokenRef.current !== requestToken || !programmaticScrollRef.current) {
          return
        }
        if (detailedLineIdsRef.current.has(lineId) || framesRemaining <= 1) {
          performScroll()
          return
        }
        waitForDetail(framesRemaining - 1)
      })
    }

    programmaticScrollRef.current = true
    setProgrammaticLineId(lineId)
    if (detailedLineIdsRef.current.has(lineId)) {
      performScroll()
    } else {
      waitForDetail(3)
    }
  }, [centerLineInList, clearProgrammaticScrollAfterAnimation, setProgrammaticLineId])

  useLayoutEffect(() => {
    if (!autoFollow || !activeLineIdRef.current) {
      return
    }
    const lineId = activeLineIdRef.current
    const frameId = window.requestAnimationFrame(() => {
      if (!centerLineInList(lineId, 'auto')) {
        return
      }
      clearProgrammaticScrollAfterAnimation(lineId)
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [
    autoFollow,
    cachedHeights,
    centerLineInList,
    clearProgrammaticScrollAfterAnimation,
    detailedLineIds,
    lineLayouts,
  ])

  useEffect(() => {
    if (!autoFollow || !activeLine) {
      return
    }
    const frameId = window.requestAnimationFrame(() => scrollLineIntoListCenter(activeLine.id))
    return () => window.cancelAnimationFrame(frameId)
  }, [activeLine, autoFollow, scrollLineIntoListCenter])

  const seekToLine = useCallback((line: LyricLineType) => {
    if (suppressClickRef.current) {
      return
    }
    setAutoFollow(true)
    scrollLineIntoListCenter(line.id)
    onSeekToLine(line)
  }, [onSeekToLine, scrollLineIntoListCenter, setAutoFollow])

  const restoreAutoFollow = () => {
    setAutoFollow(true)
    if (activeLine) {
      scrollLineIntoListCenter(activeLine.id)
    }
  }

  const setManualExplore = () => {
    if (!programmaticScrollRef.current) {
      setAutoFollow(false)
    }
  }

  const setManualExploreFromWheel = () => {
    cancelProgrammaticScroll()
    setAutoFollow(false)
  }

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    setFocusedLineId(closestLineId(event.target))
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextLineId = closestLineId(event.relatedTarget)
    setFocusedLineId(nextLineId)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !listRef.current) {
      return
    }
    cancelProgrammaticScroll()
    if (event.pointerType === 'touch') {
      setAutoFollow(false)
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
      cancelProgrammaticScroll()
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

  const activeAnnouncement = activeLine
    ? [
        localizedText(activeLine.text, song.display.defaultLyricsLanguage, ['ja', 'ko', 'en']),
        activeLine.text[song.display.defaultPronunciationLanguage] ?? '',
        ...(callsByLineId.get(activeLine.id) ?? []).map((call) =>
          localizedText(call.text, song.display.defaultCallLanguage, ['ko', 'ja', 'romaji', 'en']),
        ),
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <div className="lyric-list-shell" onWheel={setManualExploreFromWheel}>
      {!autoFollow ? (
        <Button
          label="현재 가사"
          onClick={restoreAutoFollow}
          icon={<LocateFixed size={16} aria-hidden="true" />}
          className="follow-active-button"
        />
      ) : null}
      <CountdownOverlay schedule={countdownSchedule} store={playbackTimeStore} />
      <div className="sr-only" aria-atomic="true" aria-live="polite">
        {activeAnnouncement}
      </div>
      <div
        className="lyric-list"
        data-dragging={dragging}
        data-programmatic-line-id={programmaticLineId ?? undefined}
        onBlurCapture={handleBlur}
        onFocusCapture={handleFocus}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onScroll={setManualExplore}
        onWheel={setManualExploreFromWheel}
        ref={listRef}
      >
        {song.lyrics.map((line) => {
          const detailed = detailedLineIds.has(line.id)
          return (
            <LyricLine
              key={line.id}
              line={line}
              active={activeLineId === line.id}
              calls={callsByLineId.get(line.id) ?? []}
              detailed={detailed}
              layout={lineLayouts.get(line.id)}
              minBlockSize={detailed ? undefined : cachedHeights.get(line.id)}
              lyricsLanguage={song.display.defaultLyricsLanguage}
              pronunciationLanguage={song.display.defaultPronunciationLanguage}
              callLanguage={song.display.defaultCallLanguage}
              position={activeLineId === line.id ? 'current' : 'inactive'}
              lineRef={lineRefCallbacks.get(line.id)}
              onSeek={seekToLine}
            />
          )
        })}
      </div>
    </div>
  )
}
