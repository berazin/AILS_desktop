import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react"

const WINDOW_MARGIN = 12
function constrain(value: number, viewport: number, size: number) {
  return Math.max(WINDOW_MARGIN, Math.min(value, viewport - size - WINDOW_MARGIN))
}

/** Move the properties window within the app; keep its controls visible as its content or viewport changes. */
export function useDocumentDetailDrag(panel: RefObject<HTMLElement | null>) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const keepVisible = () => {
      const bounds = element.getBoundingClientRect()
      const dx = constrain(bounds.left, window.innerWidth, bounds.width) - bounds.left
      const dy = constrain(bounds.top, window.innerHeight, bounds.height) - bounds.top
      if (dx || dy) setOffset({ x: bounds.left + dx - (window.innerWidth - bounds.width) / 2,
        y: bounds.top + dy - (window.innerHeight - bounds.height) / 2 })
    }
    const observer = new ResizeObserver(keepVisible)
    observer.observe(element)
    window.addEventListener("resize", keepVisible)
    return () => { observer.disconnect(); window.removeEventListener("resize", keepVisible); drag.current = null }
  }, [panel])

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as Element).closest("button, input, textarea, select, a")) return
    const bounds = panel.current?.getBoundingClientRect()
    if (!bounds) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = "true"
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top }
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const start = drag.current
    const bounds = panel.current?.getBoundingClientRect()
    if (!start || start.pointerId !== event.pointerId || !bounds) return
    const left = constrain(start.left + event.clientX - start.x, window.innerWidth, bounds.width)
    const top = constrain(start.top + event.clientY - start.y, window.innerHeight, bounds.height)
    setOffset({ x: left - (window.innerWidth - bounds.width) / 2, y: top - (window.innerHeight - bounds.height) / 2 })
  }

  function finishDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    event.currentTarget.dataset.dragging = "false"
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return { style: { transform: `translate(${offset.x}px, ${offset.y}px)` },
    titleBar: { onPointerDown, onPointerMove, onPointerUp: finishDrag, onPointerCancel: finishDrag, onLostPointerCapture: finishDrag } }
}
