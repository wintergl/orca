import { useCallback, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'

const COLLAPSED_HEIGHT = 40
const DEFAULT_HEIGHT = 232
const MIN_HEIGHT = 160
const MAX_HEIGHT = 320

type ResizeOrigin = {
  pointerId: number
  clientY: number
  height: number
}

export type WorkflowPreviewResize = {
  containerRef: RefObject<HTMLDivElement | null>
  height: number
  resizing: boolean
  resizeBy: (delta: number) => void
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onPointerUp: (event: PointerEvent<HTMLElement>) => void
}

export function useWorkflowPreviewResize(open: boolean): WorkflowPreviewResize {
  const containerRef = useRef<HTMLDivElement>(null)
  const resizeOrigin = useRef<ResizeOrigin | null>(null)
  const [expandedHeight, setExpandedHeight] = useState(DEFAULT_HEIGHT)
  const [resizing, setResizing] = useState(false)

  const resizeBy = useCallback((delta: number): void => {
    setExpandedHeight((height) => clampHeight(height + delta))
  }, [])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>): void => {
      if (!open || event.button !== 0) {
        return
      }
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      resizeOrigin.current = {
        pointerId: event.pointerId,
        clientY: event.clientY,
        height: expandedHeight
      }
      setResizing(true)
    },
    [expandedHeight, open]
  )

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>): void => {
    const origin = resizeOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) {
      return
    }
    const availableHeight = containerRef.current?.clientHeight ?? MAX_HEIGHT * 2
    const maxHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, availableHeight * 0.45))
    setExpandedHeight(
      Math.min(maxHeight, clampHeight(origin.height - event.clientY + origin.clientY))
    )
  }, [])

  const finishResize = useCallback((event: PointerEvent<HTMLElement>): void => {
    if (resizeOrigin.current?.pointerId !== event.pointerId) {
      return
    }
    resizeOrigin.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  return {
    containerRef,
    height: open ? expandedHeight : COLLAPSED_HEIGHT,
    resizing,
    resizeBy,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishResize
  }
}

function clampHeight(height: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height))
}
