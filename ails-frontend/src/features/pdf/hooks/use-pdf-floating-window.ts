import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"

import type { WorkspaceSessionState } from "../../../lib/workspace-session-state.ts"

type Point = { x: number; y: number }
type Size = { width: number; height: number }

function initialPosition(initialWorkspaceSession: WorkspaceSessionState | null): Point {
  try {
    const workspacePosition = initialWorkspaceSession?.pdfViewer?.position
    if (typeof workspacePosition?.x === "number" && typeof workspacePosition?.y === "number") {
      return workspacePosition
    }
    const saved = localStorage.getItem("ails_pdf_position")
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Point>
      if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed as Point
    }
  } catch {
    return { x: 50, y: 150 }
  }
  return { x: 50, y: 150 }
}

function initialSize(initialWorkspaceSession: WorkspaceSessionState | null): Size {
  try {
    const workspaceSize = initialWorkspaceSession?.pdfViewer?.size
    if (typeof workspaceSize?.width === "number" && typeof workspaceSize?.height === "number") {
      return workspaceSize
    }
    const saved = localStorage.getItem("ails_pdf_size")
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Size>
      if (typeof parsed.width === "number" && typeof parsed.height === "number") return parsed as Size
    }
  } catch {
    return { width: 850, height: 600 }
  }
  return { width: 850, height: 600 }
}

export function usePdfFloatingWindow(initialWorkspaceSession: WorkspaceSessionState | null) {
  const [pdfViewerFloating, setPdfViewerFloating] = useState(() =>
    initialWorkspaceSession?.pdfViewer?.floating ?? localStorage.getItem("ails_pdf_floating") === "true",
  )
  const [pdfViewerPosition, setPdfViewerPosition] = useState(() => initialPosition(initialWorkspaceSession))
  const [pdfViewerSize, setPdfViewerSize] = useState(() => initialSize(initialWorkspaceSession))
  const [isPdfDragging, setIsPdfDragging] = useState(false)
  const [isPdfResizing, setIsPdfResizing] = useState(false)
  const [pdfPageAspect, setPdfPageAspect] = useState<number | null>(null)
  const latestPdfPageAspectRef = useRef<number | null>(null)
  const pdfDragStart = useRef({ x: 0, y: 0 })
  const pdfPositionStart = useRef({ x: 0, y: 0 })
  const pdfResizeDirection = useRef("")
  const pdfResizeStart = useRef({ x: 0, y: 0 })
  const pdfSizeStart = useRef({ width: 0, height: 0 })

  function handlePdfDragDown(event: ReactMouseEvent) {
    if (!pdfViewerFloating) return
    if (event.target instanceof HTMLElement && event.target.closest("button, input, select, textarea")) return
    setIsPdfDragging(true)
    pdfDragStart.current = { x: event.clientX, y: event.clientY }
    pdfPositionStart.current = { ...pdfViewerPosition }
  }

  function handlePdfResizeDown(dir: string, event: ReactMouseEvent) {
    if (!pdfViewerFloating) return
    event.preventDefault()
    event.stopPropagation()
    setIsPdfResizing(true)
    pdfResizeDirection.current = dir
    pdfResizeStart.current = { x: event.clientX, y: event.clientY }
    pdfSizeStart.current = { ...pdfViewerSize }
    pdfPositionStart.current = { ...pdfViewerPosition }
  }

  const togglePdfViewerFloating = useCallback(() => {
    setPdfViewerFloating((current) => {
      const next = !current
      localStorage.setItem("ails_pdf_floating", String(next))
      return next
    })
  }, [])

  function fitPdfResizeToPageAspect(width: number, height: number, dir: string, dx: number, dy: number) {
    const aspect = latestPdfPageAspectRef.current
    if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return { width, height }

    const changedHorizontally = dir.includes("e") || dir.includes("w")
    const changedVertically = dir.includes("n") || dir.includes("s")
    const useWidthAsDriver = changedHorizontally && (!changedVertically || Math.abs(dx) >= Math.abs(dy))
    if (useWidthAsDriver) return { width, height: Math.max(300, width / aspect) }
    if (changedVertically) return { width: Math.max(400, height * aspect), height }
    return { width, height }
  }

  useEffect(() => {
    latestPdfPageAspectRef.current = pdfPageAspect
  }, [pdfPageAspect])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (isPdfDragging) {
        const dx = event.clientX - pdfDragStart.current.x
        const dy = event.clientY - pdfDragStart.current.y
        const nextX = Math.max(0, Math.min(window.innerWidth - 120, pdfPositionStart.current.x + dx))
        const nextY = Math.max(0, Math.min(window.innerHeight - 120, pdfPositionStart.current.y + dy))
        setPdfViewerPosition({ x: nextX, y: nextY })
      }
      if (isPdfResizing) {
        const dx = event.clientX - pdfResizeStart.current.x
        const dy = event.clientY - pdfResizeStart.current.y
        const dir = pdfResizeDirection.current
        let nextWidth = pdfSizeStart.current.width
        let nextHeight = pdfSizeStart.current.height
        let nextX = pdfPositionStart.current.x
        let nextY = pdfPositionStart.current.y

        if (dir.includes("e")) nextWidth = Math.max(400, pdfSizeStart.current.width + dx)
        else if (dir.includes("w")) {
          nextWidth = Math.max(400, pdfSizeStart.current.width - dx)
          nextX = pdfPositionStart.current.x + (pdfSizeStart.current.width - nextWidth)
        }
        if (dir.includes("s")) nextHeight = Math.max(300, pdfSizeStart.current.height + dy)
        else if (dir.includes("n")) {
          nextHeight = Math.max(300, pdfSizeStart.current.height - dy)
          nextY = pdfPositionStart.current.y + (pdfSizeStart.current.height - nextHeight)
        }

        const fittedSize = fitPdfResizeToPageAspect(nextWidth, nextHeight, dir, dx, dy)
        nextWidth = fittedSize.width
        nextHeight = fittedSize.height
        if (dir.includes("w")) nextX = pdfPositionStart.current.x + (pdfSizeStart.current.width - nextWidth)
        if (dir.includes("n")) nextY = pdfPositionStart.current.y + (pdfSizeStart.current.height - nextHeight)
        setPdfViewerSize({ width: nextWidth, height: nextHeight })
        setPdfViewerPosition({ x: nextX, y: nextY })
      }
    }

    const handleMouseUp = () => {
      if (isPdfDragging) localStorage.setItem("ails_pdf_position", JSON.stringify(pdfViewerPosition))
      if (isPdfResizing) localStorage.setItem("ails_pdf_size", JSON.stringify(pdfViewerSize))
      setIsPdfDragging(false)
      setIsPdfResizing(false)
    }

    if (isPdfDragging || isPdfResizing) {
      window.addEventListener("mousemove", handleMouseMove)
      window.addEventListener("mouseup", handleMouseUp)
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isPdfDragging, isPdfResizing, pdfViewerPosition, pdfViewerSize])

  return {
    handlePdfDragDown,
    handlePdfResizeDown,
    pdfViewerFloating,
    pdfViewerPosition,
    pdfViewerSize,
    setPdfPageAspect,
    setPdfViewerFloating,
    setPdfViewerPosition,
    setPdfViewerSize,
    togglePdfViewerFloating,
  }
}

export type PdfFloatingWindow = ReturnType<typeof usePdfFloatingWindow>
