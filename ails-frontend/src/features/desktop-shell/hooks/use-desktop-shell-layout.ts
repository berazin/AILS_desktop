import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react"

import {
  getAppDesktopApi,
  type AppWindowFixedPoint,
  type AppWindowResizeDirection,
} from "../../../lib/desktop-api.ts"
const APP_WINDOW_RESIZE_CURSORS: Record<AppWindowResizeDirection, string> = {
  n: "ns-resize",
  s: "ns-resize",
  w: "ew-resize",
  e: "ew-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
}
const APP_WINDOW_RESIZE_FIXED_POINTS: Record<AppWindowResizeDirection, AppWindowFixedPoint> = {
  e: "nw",
  s: "nw",
  se: "nw",
  w: "ne",
  sw: "ne",
  n: "sw",
  ne: "sw",
  nw: "se",
}

export function useDesktopShellLayout() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }))

  useEffect(() => {
    const api = getAppDesktopApi()
    if (api?.is_maximized) {
      void api.is_maximized().then((max) => {
        if (typeof max === "boolean") setIsMaximized(max)
      })
    }
    if (api?.on_maximize_change) {
      return api.on_maximize_change((max) => setIsMaximized(Boolean(max)))
    }
  }, [])

  useEffect(() => {
    function handleResize() {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight })
    }
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  function handleAppWindowResizeMouseDown(direction: AppWindowResizeDirection, event: ReactMouseEvent<HTMLDivElement>) {
    if (isMaximized) return
    const api = getAppDesktopApi()
    const canResizeManually = Boolean(api?.resize_window)
    if (!canResizeManually && !api?.start_window_resize) return
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const startWidth = window.innerWidth
    const startHeight = window.innerHeight
    const fixedPoint = APP_WINDOW_RESIZE_FIXED_POINTS[direction]
    const cursor = APP_WINDOW_RESIZE_CURSORS[direction]
    let pendingFrame: number | null = null
    let nextSize = { width: startWidth, height: startHeight }
    let releasedBeforeFallback = false
    const markReleasedBeforeFallback = () => { releasedBeforeFallback = true }

    const applyResize = (width: number, height: number) => {
      if (!api?.resize_window) return
      const resizeResult = api.resize_window(Math.round(width), Math.round(height), fixedPoint)
      if (resizeResult?.catch) resizeResult.catch((error: unknown) => console.warn("Failed to resize app window", error))
    }
    const scheduleResize = (width: number, height: number) => {
      nextSize = { width, height }
      if (pendingFrame !== null) return
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null
        applyResize(nextSize.width, nextSize.height)
      })
    }
    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault()
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      let nextWidth = startWidth
      let nextHeight = startHeight
      if (direction.includes("e")) nextWidth = startWidth + dx
      if (direction.includes("w")) nextWidth = startWidth - dx
      if (direction.includes("s")) nextHeight = startHeight + dy
      if (direction.includes("n")) nextHeight = startHeight - dy
      scheduleResize(Math.max(720, nextWidth), Math.max(480, nextHeight))
    }
    const stopResize = () => {
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame)
        pendingFrame = null
      }
      applyResize(nextSize.width, nextSize.height)
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", stopResize)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    const startManualResize = () => {
      window.removeEventListener("mouseup", markReleasedBeforeFallback)
      if (releasedBeforeFallback) return
      document.body.style.cursor = cursor
      document.body.style.userSelect = "none"
      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", stopResize)
    }

    if (canResizeManually) {
      startManualResize()
      const nativeResizeResult = api?.start_window_resize?.(direction)
      if (nativeResizeResult?.catch) nativeResizeResult.catch((error: unknown) => console.warn("Failed to start native app window resize", error))
      return
    }
    const nativeResizeResult = api?.start_window_resize?.(direction)
    if (nativeResizeResult?.then) {
      window.addEventListener("mouseup", markReleasedBeforeFallback, { once: true })
      nativeResizeResult
        .then((started: boolean) => {
          if (started) {
            window.removeEventListener("mouseup", markReleasedBeforeFallback)
            return
          }
          startManualResize()
        })
        .catch(() => startManualResize())
    }
  }

  return { handleAppWindowResizeMouseDown, isMaximized, setIsMaximized, viewportSize }
}
