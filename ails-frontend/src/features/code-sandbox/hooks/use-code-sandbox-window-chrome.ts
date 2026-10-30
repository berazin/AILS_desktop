import { useEffect, useRef, useState } from "react"
import type * as React from "react"
import {
  codeSandboxResizeCursor,
  codeSandboxResizeDirection,
  isConsoleTopResizeHit,
  type WindowResizeDirection,
} from "../code-sandbox-window-geometry.ts"

/* Window chrome state for CodeSandboxWindow: persisted position/size,
   border drag/resize, and console/sidebar/AI-review resize handling.
   Extracted verbatim from code-sandbox.tsx; names match the original
   component state so JSX references stay identical. */

export function useCodeSandboxWindowChrome({
  debugOutputVisible,
  isSnapped = false,
  snappedLayout,
  storagePrefix = "ails_sandbox",
}: {
  debugOutputVisible: boolean
  isSnapped?: boolean
  snappedLayout?: { x: number; y: number; width: number; height: number }
  storagePrefix?: string
}) {
  const [position, setPosition] = useState(() => {
    try {
      const saved = localStorage.getItem(`${storagePrefix}_position`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          const x = Math.max(0, Math.min(window.innerWidth - 120, parsed.x))
          const y = Math.max(0, Math.min(window.innerHeight - 120, parsed.y))
          return { x, y }
        }
      }
    } catch {
      /* window position restore is best-effort */
    }
    return { x: Math.max(16, window.innerWidth - 740), y: 120 }
  })
  const [size, setSize] = useState(() => {
    try {
      const saved = localStorage.getItem(`${storagePrefix}_size`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.width === "number" && typeof parsed.height === "number") {
          return {
            width: Math.max(560, parsed.width),
            height: Math.max(410, parsed.height),
          }
        }
      }
    } catch {
      /* window size restore is best-effort */
    }
    return { width: 720, height: 560 }
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(`${storagePrefix}_sidebar_width`))
    return Number.isFinite(saved) ? Math.min(360, Math.max(120, saved)) : 160
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const positionStart = useRef({ x: 0, y: 0 })

  const [isResizing, setIsResizing] = useState(false)
  const [resizeHoverDirection, setResizeHoverDirection] = useState<WindowResizeDirection | "">("")
  const resizeDirection = useRef<WindowResizeDirection | "">("")
  const resizeStart = useRef({ x: 0, y: 0 })
  const sizeStart = useRef({ width: 0, height: 0 })
  const suppressNextBorderClickRef = useRef(false)
  const suppressNextBorderClickTimerRef = useRef<number | null>(null)

  const [consoleHeight, setConsoleHeight] = useState(() => {
    const saved = Number(localStorage.getItem(`${storagePrefix}_console_height`))
    return Number.isFinite(saved) ? Math.min(340, Math.max(110, saved)) : 170
  })
  const [aiReviewHeight, setAiReviewHeight] = useState(() => {
    const saved = Number(localStorage.getItem(`${storagePrefix}_ai_review_height`))
    return Number.isFinite(saved) ? Math.min(360, Math.max(120, saved)) : 190
  })
  const [isConsoleResizing, setIsConsoleResizing] = useState(false)
  const [isConsoleResizeHovered, setIsConsoleResizeHovered] = useState(false)
  const consoleResizeStart = useRef({ y: 0, height: 0 })
  const [isAiReviewResizing, setIsAiReviewResizing] = useState(false)
  const aiReviewResizeStart = useRef({ y: 0, height: 0 })
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const sidebarResizeStart = useRef({ x: 0, width: 0 })

  useEffect(() => {
    if (!isSnapped) return
    const nextPosition = {
      x: snappedLayout?.x ?? 0,
      y: snappedLayout?.y ?? 0,
    }
    const nextSize = {
      width: Math.max(420, snappedLayout?.width ?? Math.floor(window.innerWidth / 2)),
      height: Math.max(420, snappedLayout?.height ?? window.innerHeight),
    }
    setPosition((current) =>
      current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition,
    )
    setSize((current) =>
      current.width === nextSize.width && current.height === nextSize.height ? current : nextSize,
    )
  }, [isSnapped, snappedLayout?.height, snappedLayout?.width, snappedLayout?.x, snappedLayout?.y])

  useEffect(() => {
    if (isSnapped) return
    if (position.x !== undefined && position.y !== undefined) {
      localStorage.setItem(`${storagePrefix}_position`, JSON.stringify(position))
    }
  }, [isSnapped, position, storagePrefix])

  useEffect(() => {
    if (isSnapped) return
    if (size.width !== undefined && size.height !== undefined) {
      localStorage.setItem(`${storagePrefix}_size`, JSON.stringify(size))
    }
  }, [isSnapped, size, storagePrefix])

  useEffect(() => {
    if (sidebarWidth !== undefined) {
      localStorage.setItem(`${storagePrefix}_sidebar_width`, String(sidebarWidth))
    }
  }, [sidebarWidth, storagePrefix])

  useEffect(() => {
    if (consoleHeight !== undefined) {
      if (storagePrefix === "ails_sandbox") localStorage.setItem("ails_sandbox_console_height", String(consoleHeight))
      else localStorage.setItem(`${storagePrefix}_console_height`, String(consoleHeight))
    }
  }, [consoleHeight, storagePrefix])

  useEffect(() => {
    if (aiReviewHeight !== undefined) {
      localStorage.setItem(`${storagePrefix}_ai_review_height`, String(aiReviewHeight))
    }
  }, [aiReviewHeight, storagePrefix])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging) {
        const dx = event.clientX - dragStart.current.x
        const dy = event.clientY - dragStart.current.y
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - 120, positionStart.current.x + dx)),
          y: Math.max(0, Math.min(window.innerHeight - 120, positionStart.current.y + dy)),
        })
      }
      if (isResizing) {
        const dx = event.clientX - resizeStart.current.x
        const dy = event.clientY - resizeStart.current.y
        const dir = resizeDirection.current

        let nextWidth = sizeStart.current.width
        let nextHeight = sizeStart.current.height
        let nextX = positionStart.current.x
        let nextY = positionStart.current.y

        if (dir.includes("e")) {
          nextWidth = Math.max(560, sizeStart.current.width + dx)
        } else if (dir.includes("w")) {
          nextWidth = Math.max(560, sizeStart.current.width - dx)
          const actualDx = sizeStart.current.width - nextWidth
          nextX = positionStart.current.x + actualDx
        }

        if (dir.includes("s")) {
          nextHeight = Math.max(410, sizeStart.current.height + dy)
        } else if (dir.includes("n")) {
          nextHeight = Math.max(410, sizeStart.current.height - dy)
          const actualDy = sizeStart.current.height - nextHeight
          nextY = positionStart.current.y + actualDy
        }

        setSize({ width: nextWidth, height: nextHeight })
        setPosition({ x: nextX, y: nextY })
      }
      if (isConsoleResizing) {
        const dy = event.clientY - consoleResizeStart.current.y
        const maxConsoleHeight = Math.max(110, size.height - 170)
        setConsoleHeight(Math.min(maxConsoleHeight, Math.max(90, consoleResizeStart.current.height - dy)))
      }
      if (isAiReviewResizing) {
        const dy = event.clientY - aiReviewResizeStart.current.y
        const consoleSpace = debugOutputVisible ? consoleHeight : 0
        const maxAiReviewHeight = Math.max(120, size.height - consoleSpace - 170)
        setAiReviewHeight(Math.min(maxAiReviewHeight, Math.max(110, aiReviewResizeStart.current.height - dy)))
      }
      if (isSidebarResizing) {
        const dx = event.clientX - sidebarResizeStart.current.x
        setSidebarWidth(Math.min(360, Math.max(120, sidebarResizeStart.current.width + dx)))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
      setResizeHoverDirection("")
      setIsConsoleResizing(false)
      setIsConsoleResizeHovered(false)
      setIsAiReviewResizing(false)
      setIsSidebarResizing(false)
      if (suppressNextBorderClickRef.current) {
        if (suppressNextBorderClickTimerRef.current !== null) {
          window.clearTimeout(suppressNextBorderClickTimerRef.current)
        }
        suppressNextBorderClickTimerRef.current = window.setTimeout(() => {
          suppressNextBorderClickRef.current = false
          suppressNextBorderClickTimerRef.current = null
        }, 0)
      }
    }

    if (isDragging || isResizing || isConsoleResizing || isAiReviewResizing || isSidebarResizing) {
      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
      window.addEventListener("blur", handleMouseUp)
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      window.removeEventListener("blur", handleMouseUp)
    }
  }, [aiReviewHeight, consoleHeight, debugOutputVisible, isAiReviewResizing, isConsoleResizing, isDragging, isResizing, isSidebarResizing, sidebarWidth, size.height, size.width, position])

  useEffect(() => {
    if (!isResizing && !isConsoleResizing) return
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = isConsoleResizing
      ? "ns-resize"
      : codeSandboxResizeCursor(resizeDirection.current) || ""
    document.body.style.userSelect = "none"
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isConsoleResizing, isResizing])

  useEffect(() => {
    if (!isSnapped) return
    setIsDragging(false)
    setIsResizing(false)
    setResizeHoverDirection("")
    if (suppressNextBorderClickRef.current) {
      if (suppressNextBorderClickTimerRef.current !== null) {
        window.clearTimeout(suppressNextBorderClickTimerRef.current)
      }
      suppressNextBorderClickTimerRef.current = window.setTimeout(() => {
        suppressNextBorderClickRef.current = false
        suppressNextBorderClickTimerRef.current = null
      }, 0)
    }
  }, [isSnapped])

  function handleWindowBorderMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.target as Node)) return
    if (isSnapped) {
      setResizeHoverDirection("")
      return
    }
    if (isDragging || isResizing || isConsoleResizing || isAiReviewResizing || isSidebarResizing) return
    const direction = codeSandboxResizeDirection(event.currentTarget, event.clientX, event.clientY)
    setResizeHoverDirection((current) => current === direction ? current : direction)
  }

  function handleWindowBorderMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.target as Node)) return
    if (isSnapped || event.button !== 0 || isDragging || isResizing || isConsoleResizing || isAiReviewResizing || isSidebarResizing) return
    const direction = codeSandboxResizeDirection(event.currentTarget, event.clientX, event.clientY)
    if (!direction) return
    if (suppressNextBorderClickTimerRef.current !== null) {
      window.clearTimeout(suppressNextBorderClickTimerRef.current)
      suppressNextBorderClickTimerRef.current = null
    }
    suppressNextBorderClickRef.current = true
    setResizeHoverDirection(direction)
    handleResizeDown(direction, event)
  }

  function handleWindowClickCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.target as Node)) return
    if (!suppressNextBorderClickRef.current) return
    suppressNextBorderClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function handleDragDown(event: React.MouseEvent) {
    if (isSnapped || event.button !== 0 || isResizing) return
    if (event.target instanceof HTMLElement && event.target.closest("button, input, select, textarea")) return
    setIsDragging(true)
    dragStart.current = { x: event.clientX, y: event.clientY }
    positionStart.current = { ...position }
  }

  function handleResizeDown(dir: WindowResizeDirection, event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setIsResizing(true)
    resizeDirection.current = dir
    resizeStart.current = { x: event.clientX, y: event.clientY }
    sizeStart.current = { ...size }
    positionStart.current = { ...position }
  }

  function handleConsoleBorderMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (isConsoleResizing) return
    if (isDragging || isResizing || isAiReviewResizing || isSidebarResizing) {
      setIsConsoleResizeHovered(false)
      return
    }
    const hovered = isConsoleTopResizeHit(event.currentTarget, event.clientY)
    setIsConsoleResizeHovered((current) => current === hovered ? current : hovered)
  }

  function handleConsoleBorderMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || isDragging || isResizing || isConsoleResizing || isAiReviewResizing || isSidebarResizing) return
    if (!isConsoleTopResizeHit(event.currentTarget, event.clientY)) return
    setIsConsoleResizeHovered(true)
    handleConsoleResizeDown(event)
  }

  function handleConsoleResizeDown(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setIsConsoleResizing(true)
    consoleResizeStart.current = { y: event.clientY, height: consoleHeight }
  }


  function handleSidebarResizeDown(event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setIsSidebarResizing(true)
    sidebarResizeStart.current = { x: event.clientX, width: sidebarWidth }
  }

  return {
    position,
    setPosition,
    size,
    setSize,
    sidebarWidth,
    consoleHeight,
    aiReviewHeight,
    isDragging,
    isResizing,
    resizeHoverDirection,
    setResizeHoverDirection,
    isConsoleResizing,
    setIsConsoleResizing,
    isConsoleResizeHovered,
    setIsConsoleResizeHovered,
    isAiReviewResizing,
    setIsAiReviewResizing,
    isSidebarResizing,
    setIsSidebarResizing,
    handleWindowBorderMouseMove,
    handleWindowBorderMouseDown,
    handleWindowClickCapture,
    handleDragDown,
    handleResizeDown,
    handleConsoleBorderMouseMove,
    handleConsoleBorderMouseDown,
    handleConsoleResizeDown,
    handleSidebarResizeDown,
    suppressNextBorderClickRef,
    suppressNextBorderClickTimerRef,
  }
}
