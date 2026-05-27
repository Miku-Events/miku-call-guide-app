import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

export interface OverflowDragScrollResult<T extends HTMLElement> {
  ref: React.RefObject<T | null>
  canDrag: boolean
  isDragging: boolean
  dragScrollProps: {
    onClickCapture: (event: ReactMouseEvent<T>) => void
    onMouseDownCapture: () => void
    onPointerCancel: (event: ReactPointerEvent<T>) => void
    onPointerDownCapture: (event: ReactPointerEvent<T>) => void
    onPointerMove: (event: ReactPointerEvent<T>) => void
    onPointerUp: (event: ReactPointerEvent<T>) => void
  }
}

function isScrollable(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
}

function shouldIgnoreDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [data-sheet-dismiss-handle="true"]'))
}

export function useOverflowDragScroll<T extends HTMLElement>(): OverflowDragScrollResult<T> {
  const ref = useRef<T>(null)
  const dragStateRef = useRef<{
    captured: boolean
    moved: boolean
    pointerId: number
    scrollLeft: number
    scrollTop: number
    x: number
    y: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [canDrag, setCanDrag] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    const updateCanDrag = () => setCanDrag(isScrollable(element))
    updateCanDrag()

    const observer = new ResizeObserver(updateCanDrag)
    observer.observe(element)
    Array.from(element.children).forEach((child) => observer.observe(child))
    const mutationObserver = new MutationObserver(updateCanDrag)
    mutationObserver.observe(element, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      mutationObserver.disconnect()
    }
  }, [])

  const endDrag = useCallback((event: ReactPointerEvent<T>) => {
    const state = dragStateRef.current
    if (!state) {
      return
    }

    if (event.currentTarget.hasPointerCapture(state.pointerId)) {
      event.currentTarget.releasePointerCapture(state.pointerId)
    }
    dragStateRef.current = null
    setIsDragging(false)

    if (state.moved) {
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
  }, [])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<T>) => {
      const element = ref.current
      if (!element || event.button !== 0 || shouldIgnoreDragTarget(event.target) || !isScrollable(element)) {
        return
      }

      suppressClickRef.current = false
      setCanDrag(true)
      dragStateRef.current = {
        captured: false,
        moved: false,
        pointerId: event.pointerId,
        scrollLeft: element.scrollLeft,
        scrollTop: element.scrollTop,
        x: event.clientX,
        y: event.clientY,
      }
    },
    [],
  )

  const onPointerMove = useCallback((event: ReactPointerEvent<T>) => {
    const state = dragStateRef.current
    const element = ref.current
    if (!state || !element) {
      return
    }

    const deltaX = event.clientX - state.x
    const deltaY = event.clientY - state.y
    if (!state.moved && Math.hypot(deltaX, deltaY) < 5) {
      return
    }

    if (!state.captured) {
      event.currentTarget.setPointerCapture(state.pointerId)
      state.captured = true
    }
    state.moved = true
    setIsDragging(true)
    element.scrollLeft = state.scrollLeft - deltaX
    element.scrollTop = state.scrollTop - deltaY
    event.preventDefault()
  }, [])

  const onClickCapture = useCallback((event: ReactMouseEvent<T>) => {
    if (!suppressClickRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    suppressClickRef.current = false
  }, [])

  const onMouseDownCapture = useCallback(() => {
    suppressClickRef.current = false
  }, [])

  return {
    ref,
    canDrag,
    isDragging,
    dragScrollProps: {
      onClickCapture,
      onMouseDownCapture,
      onPointerCancel: endDrag,
      onPointerDownCapture: onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
    },
  }
}
