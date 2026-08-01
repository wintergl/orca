import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, RefObject, WheelEvent } from 'react'

const MIN_SCALE = 0.55
const MAX_SCALE = 1.6
const SCALE_STEP = 0.1
const FIT_GUTTER = 48

type CanvasTransform = {
  x: number
  y: number
  scale: number
}

type PointerOrigin = {
  pointerId: number
  clientX: number
  clientY: number
  x: number
  y: number
}

export type WorkflowCanvasNavigation = {
  viewportRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  transform: CanvasTransform
  panning: boolean
  fitWorkflow: () => void
  zoomIn: () => void
  zoomOut: () => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onWheel: (event: WheelEvent<HTMLDivElement>) => void
}

export function useWorkflowCanvasNavigation(fitVersion: string): WorkflowCanvasNavigation {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pointerOrigin = useRef<PointerOrigin | null>(null)
  const [panning, setPanning] = useState(false)
  const [transform, setTransform] = useState<CanvasTransform>({ x: 0, y: 0, scale: 1 })

  const fitWorkflow = useCallback((): void => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) {
      return
    }
    const availableWidth = Math.max(1, viewport.clientWidth - FIT_GUTTER * 2)
    const availableHeight = Math.max(1, viewport.clientHeight - FIT_GUTTER * 2)
    const width = Math.max(1, content.scrollWidth)
    const height = Math.max(1, content.scrollHeight)
    setTransform({
      x: 0,
      y: 0,
      scale: clampScale(Math.min(availableWidth / width, availableHeight / height, 1))
    })
  }, [])

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(fitWorkflow)
    return () => window.cancelAnimationFrame(frame)
  }, [fitVersion, fitWorkflow])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const observer = new ResizeObserver(fitWorkflow)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [fitWorkflow])

  const zoomBy = useCallback((delta: number): void => {
    setTransform((current) => ({
      ...current,
      scale: clampScale(current.scale + delta)
    }))
  }, [])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0 || isInteractiveTarget(event.target)) {
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      pointerOrigin.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        x: transform.x,
        y: transform.y
      }
      setPanning(true)
    },
    [transform.x, transform.y]
  )

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const origin = pointerOrigin.current
    if (!origin || origin.pointerId !== event.pointerId) {
      return
    }
    setTransform((current) => ({
      ...current,
      x: origin.x + event.clientX - origin.clientX,
      y: origin.y + event.clientY - origin.clientY
    }))
  }, [])

  const finishPanning = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (pointerOrigin.current?.pointerId !== event.pointerId) {
      return
    }
    pointerOrigin.current = null
    setPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onWheel = useCallback((event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    if (event.metaKey || event.ctrlKey) {
      const delta = event.deltaY > 0 ? -SCALE_STEP : SCALE_STEP
      setTransform((current) => ({
        ...current,
        scale: clampScale(current.scale + delta)
      }))
      return
    }
    setTransform((current) => ({
      ...current,
      x: current.x - (event.shiftKey ? event.deltaY : event.deltaX),
      y: current.y - (event.shiftKey ? 0 : event.deltaY)
    }))
  }, [])

  return {
    viewportRef,
    contentRef,
    transform,
    panning,
    fitWorkflow,
    zoomIn: () => zoomBy(SCALE_STEP),
    zoomOut: () => zoomBy(-SCALE_STEP),
    onPointerDown,
    onPointerMove,
    onPointerUp: finishPanning,
    onWheel
  }
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function isInteractiveTarget(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest('button, input, textarea, select, a'))
}
