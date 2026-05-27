import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from 'react'

export interface SheetDismissHandleResult {
  dragY: number
  isDragging: boolean
  handleProps: {
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
    onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  }
}

function shouldDismissSheet(deltaY: number, elapsedMs: number): boolean {
  const velocity = deltaY / Math.max(1, elapsedMs)
  return deltaY >= 72 || (deltaY >= 32 && velocity >= 0.6)
}

export function useSheetDismissHandle(enabled: boolean, onDismiss: () => void): SheetDismissHandleResult {
  const dragStateRef = useRef<{
    lastDeltaY: number
    moved: boolean
    pointerId: number
    startTime: number
    x: number
    y: number
  } | null>(null)
  const suppressClickRef = useRef(false)
  const [dragY, setDragY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const resetDrag = useCallback(() => {
    dragStateRef.current = null
    setDragY(0)
    setIsDragging(false)
  }, [])

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const state = dragStateRef.current
      if (!state) {
        return
      }

      if (event.currentTarget.hasPointerCapture(state.pointerId)) {
        event.currentTarget.releasePointerCapture(state.pointerId)
      }

      const deltaY = Math.max(state.lastDeltaY, event.clientY - state.y, 0)
      const elapsedMs = window.performance.now() - state.startTime
      const shouldDismiss = shouldDismissSheet(deltaY, elapsedMs)

      if (state.moved) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }

      resetDrag()

      if (shouldDismiss) {
        onDismiss()
      }
    },
    [onDismiss, resetDrag],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled || event.button !== 0) {
        return
      }

      suppressClickRef.current = false
      dragStateRef.current = {
        lastDeltaY: 0,
        moved: false,
        pointerId: event.pointerId,
        startTime: window.performance.now(),
        x: event.clientX,
        y: event.clientY,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [enabled],
  )

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current
    if (!state) {
      return
    }

    const deltaX = event.clientX - state.x
    const deltaY = event.clientY - state.y
    if (!state.moved && Math.hypot(deltaX, deltaY) < 5) {
      return
    }

    state.moved = true
    state.lastDeltaY = Math.max(0, deltaY)
    setIsDragging(true)
    setDragY(state.lastDeltaY)
    event.preventDefault()
  }, [])

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        event.preventDefault()
        event.stopPropagation()
        suppressClickRef.current = false
        return
      }

      if (enabled) {
        onDismiss()
      }
    },
    [enabled, onDismiss],
  )

  const onMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (!enabled || event.button !== 0) {
        return
      }

      if (dragStateRef.current && dragStateRef.current.pointerId !== -1) {
        return
      }

      const state = {
        lastDeltaY: 0,
        moved: false,
        pointerId: -1,
        startTime: window.performance.now(),
        x: event.clientX,
        y: event.clientY,
      }
      dragStateRef.current = state
      suppressClickRef.current = false

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - state.x
        const deltaY = moveEvent.clientY - state.y
        if (!state.moved && Math.hypot(deltaX, deltaY) < 5) {
          return
        }

        state.moved = true
        state.lastDeltaY = Math.max(0, deltaY)
        setIsDragging(true)
        setDragY(state.lastDeltaY)
        moveEvent.preventDefault()
      }

      const handleMouseUp = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)

        const deltaY = Math.max(state.lastDeltaY, upEvent.clientY - state.y, 0)
        const shouldDismiss = shouldDismissSheet(deltaY, window.performance.now() - state.startTime)

        if (state.moved) {
          suppressClickRef.current = true
          window.setTimeout(() => {
            suppressClickRef.current = false
          }, 0)
        }

        resetDrag()

        if (shouldDismiss) {
          onDismiss()
        }
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      event.preventDefault()
    },
    [enabled, onDismiss, resetDrag],
  )

  return {
    dragY,
    isDragging,
    handleProps: {
      onClick,
      onMouseDown,
      onPointerCancel: finishDrag,
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
    },
  }
}
