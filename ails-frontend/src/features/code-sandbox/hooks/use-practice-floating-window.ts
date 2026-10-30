import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { clampPracticeWindowBounds, readPracticeWindowBounds, writePracticeWindowBounds, type PracticeWindowBounds as Bounds } from "../lib/practice-window-bounds.ts"

function clampBounds(value: Bounds): Bounds {
  return clampPracticeWindowBounds(value, { width: innerWidth, height: innerHeight })
}

export function usePracticeFloatingWindow({ width = 680, height = 760, x = 16, y = 64, storageKey }: Partial<Bounds> & { storageKey?: string } = {}) {
  const [bounds, setBounds] = useState(() => {
    const fallback = clampBounds({ x, y, width: Math.min(width, innerWidth - 32), height: Math.min(height, innerHeight - 88) })
    try {
      return storageKey ? readPracticeWindowBounds(localStorage, storageKey, fallback, { width: innerWidth, height: innerHeight }) : fallback
    } catch { return fallback }
  })
  const gesture = useRef<null | { kind: "move" | "resize"; pointer: number; x: number; y: number; initial: Bounds }>(null)
  useEffect(() => {
    if (!storageKey) return
    try { writePracticeWindowBounds(localStorage, storageKey, bounds) } catch { /* Local storage may be unavailable. */ }
  }, [bounds, storageKey])
  useEffect(() => {
    const resize = () => setBounds(current => clampBounds(current))
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])
  function start(event: PointerEvent<HTMLElement>, kind: "move" | "resize") {
    if (event.button !== 0 || (event.target instanceof Element && kind === "move" && event.target.closest("button, input, select, textarea"))) return
    event.preventDefault()
    event.stopPropagation()
    if (kind === "resize") event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { kind, pointer: event.pointerId, x: event.clientX, y: event.clientY, initial: bounds }
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current
    if (!active || event.pointerId !== active.pointer) return
    const dx = event.clientX - active.x, dy = event.clientY - active.y
    setBounds(clampBounds(active.kind === "move"
      ? { ...active.initial, x: active.initial.x + dx, y: active.initial.y + dy }
      : { ...active.initial, width: Math.min(innerWidth - active.initial.x - 8, active.initial.width + dx), height: Math.min(innerHeight - active.initial.y - 8, active.initial.height + dy) }))
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointer !== event.pointerId) return
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return {
    style: { left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height },
    drag: { onPointerDown: (event: PointerEvent<HTMLElement>) => start(event, "move"), onPointerMove: move, onPointerUp: end, onPointerCancel: end },
    resize: { onPointerDown: (event: PointerEvent<HTMLElement>) => start(event, "resize"), onPointerMove: move, onPointerUp: end, onPointerCancel: end,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const dx = event.key === "ArrowRight" ? 24 : event.key === "ArrowLeft" ? -24 : 0
        const dy = event.key === "ArrowDown" ? 24 : event.key === "ArrowUp" ? -24 : 0
        if (dx || dy) {
          event.preventDefault()
          event.stopPropagation()
          setBounds(current => clampBounds({ ...current, width: current.width + dx, height: current.height + dy }))
        }
      } },
  }
}
