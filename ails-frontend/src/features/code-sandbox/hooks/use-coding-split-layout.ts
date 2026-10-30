import { useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react"

import { pdfPracticeSplitLayout } from "../../../lib/pdf-view-layout.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import type { PracticeTutorWorkspace } from "../../practice-tutor/hooks/use-practice-tutor-workspace.ts"
import { practiceTutorLayout } from "../../practice-tutor/lib/practice-tutor-layout.ts"

export const CODING_SPLIT_MIN_EDITOR_WIDTH = 420
export const CODING_SPLIT_MIN_PDF_WIDTH = 360
export const CODING_SPLIT_HANDLE_WIDTH = 12
export const DESKTOP_TITLE_BAR_HEIGHT = 32

type Point = { x: number; y: number }
type Size = { width: number; height: number }

type UseCodingSplitLayoutOptions = {
  tutor?: PracticeTutorWorkspace
  active: boolean
  floating: boolean
  setPdfViewerPosition: Dispatch<SetStateAction<Point>>
  setPdfViewerSize: Dispatch<SetStateAction<Size>>
  viewportSize: Size
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function useCodingSplitLayout({
  tutor,
  active,
  floating,
  setPdfViewerPosition,
  setPdfViewerSize,
  viewportSize,
}: UseCodingSplitLayoutOptions) {
  const [codingSplitX, setCodingSplitX] = useState(() => {
    const saved = Number(localStorage.getItem("ails_coding_split_x"))
    const fallback = typeof window === "undefined" ? 720 : window.innerWidth / 2
    const width = typeof window === "undefined" ? 1440 : window.innerWidth
    return clamp(
      Number.isFinite(saved) && saved > 0 ? saved : fallback,
      CODING_SPLIT_MIN_EDITOR_WIDTH,
      Math.max(CODING_SPLIT_MIN_EDITOR_WIDTH, width - CODING_SPLIT_MIN_PDF_WIDTH),
    )
  })
  const latestCodingSplitXRef = useRef(codingSplitX)
  const animationFrameRef = useRef<number | null>(null)
  const pendingSplitXRef = useRef<number | null>(null)
  const pendingPersistXRef = useRef<number | null>(null)
  const persistTimerRef = useRef<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const normalPracticeSplitLayout = useMemo(() => pdfPracticeSplitLayout({
    viewportWidth: viewportSize.width,
    viewportHeight: viewportSize.height,
    splitX: codingSplitX,
    titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
    minEditorWidth: CODING_SPLIT_MIN_EDITOR_WIDTH,
    minPdfWidth: CODING_SPLIT_MIN_PDF_WIDTH,
  }), [viewportSize.width, viewportSize.height, codingSplitX])
  const tutorActive = Boolean(tutor?.open && tutor.context?.source_kind === "pdf")
  const tutorSidebar = tutor?.sidebarWidth ?? 160, tutorChat = tutor?.chatWidth ?? 370, tutorExpanded = tutor?.navigationExpanded ?? false
  const tutorSolution = tutor?.solutionWidth ?? null
  const tutorNormalSidebar = tutor?.normalSidebarWidth ?? tutorSidebar
  const currentPracticeSplitLayout = useMemo(() => tutorActive
    ? practiceTutorLayout(normalPracticeSplitLayout, viewportSize.width, viewportSize.height, tutorSidebar, tutorChat, tutorExpanded, tutorSolution, tutorNormalSidebar).split
    : normalPracticeSplitLayout, [normalPracticeSplitLayout, tutorActive, viewportSize.width, viewportSize.height, tutorSidebar, tutorChat, tutorExpanded, tutorSolution, tutorNormalSidebar])
  const publishBase = tutor?.setBase
  useEffect(() => {
    if (active && publishBase) publishBase(previous => JSON.stringify(previous) === JSON.stringify(normalPracticeSplitLayout) ? previous : normalPracticeSplitLayout)
  }, [active, publishBase, normalPracticeSplitLayout])
  const clampedCodingSplitX = currentPracticeSplitLayout.splitX
  const snappedCodeLayout = useMemo(() => ({
    x: currentPracticeSplitLayout.editor.position.x,
    y: currentPracticeSplitLayout.editor.position.y,
    width: currentPracticeSplitLayout.editor.size.width,
    height: currentPracticeSplitLayout.editor.size.height,
  }), [
    currentPracticeSplitLayout.editor.position.x,
    currentPracticeSplitLayout.editor.position.y,
    currentPracticeSplitLayout.editor.size.width,
    currentPracticeSplitLayout.editor.size.height,
  ])

  const buildLayout = useEventCallback((splitX: number) => {
    const layout = pdfPracticeSplitLayout({
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      splitX,
      titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
      minEditorWidth: CODING_SPLIT_MIN_EDITOR_WIDTH,
      minPdfWidth: CODING_SPLIT_MIN_PDF_WIDTH,
    })
    return {
      splitX: layout.splitX,
      editor: layout.editor,
      position: layout.pdf.position,
      size: layout.pdf.size,
    }
  })

  const persistLayout = useEventCallback((splitX: number) => {
    const layout = buildLayout(splitX)
    localStorage.setItem("ails_sandbox_position", JSON.stringify(layout.editor.position))
    localStorage.setItem("ails_sandbox_size", JSON.stringify(layout.editor.size))
    localStorage.setItem("ails_coding_split_x", String(layout.splitX))
    localStorage.setItem("ails_pdf_position", JSON.stringify(layout.position))
    localStorage.setItem("ails_pdf_size", JSON.stringify(layout.size))
  })

  const schedulePersistLayout = useEventCallback((splitX: number) => {
    pendingPersistXRef.current = splitX
    if (persistTimerRef.current !== null) return
    persistTimerRef.current = window.setTimeout(() => {
      if (pendingPersistXRef.current !== null) {
        persistLayout(pendingPersistXRef.current)
        pendingPersistXRef.current = null
      }
      persistTimerRef.current = null
    }, 180)
  })

  const applySplit = useEventCallback((splitX: number, persist = false) => {
    const layout = buildLayout(splitX)
    latestCodingSplitXRef.current = layout.splitX
    setCodingSplitX(layout.splitX)
    setPdfViewerPosition(layout.position)
    setPdfViewerSize(layout.size)
    if (persist) persistLayout(layout.splitX)
    return layout
  })

  const flushPendingSplit = useEventCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (pendingSplitXRef.current !== null) {
      applySplit(pendingSplitXRef.current)
      pendingSplitXRef.current = null
    }
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    pendingPersistXRef.current = null
    persistLayout(latestCodingSplitXRef.current)
  })

  const scheduleSplit = useEventCallback((splitX: number) => {
    pendingSplitXRef.current = splitX
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      const nextSplitX = pendingSplitXRef.current
      pendingSplitXRef.current = null
      if (nextSplitX === null) return
      const layout = applySplit(nextSplitX)
      schedulePersistLayout(layout.splitX)
    })
  })

  const handleCodingSplitMouseDown = useEventCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!active || tutorActive) return
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  })

  useEffect(() => {
    latestCodingSplitXRef.current = clampedCodingSplitX
  }, [clampedCodingSplitX])

  useEffect(() => {
    if (!isDragging) return
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const handleMouseMove = (event: MouseEvent) => scheduleSplit(event.clientX)
    const handleMouseUp = () => {
      flushPendingSplit()
      setIsDragging(false)
    }
    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [flushPendingSplit, isDragging, scheduleSplit, viewportSize.height, viewportSize.width])

  useEffect(() => {
    if (!active || !floating || isDragging) return
    if (tutorActive) {
      setPdfViewerPosition(currentPracticeSplitLayout.pdf.position)
      setPdfViewerSize(currentPracticeSplitLayout.pdf.size)
      return
    }
    applySplit(clampedCodingSplitX, true)
  }, [active, applySplit, clampedCodingSplitX, floating, isDragging, viewportSize.height, viewportSize.width, tutorActive,
    currentPracticeSplitLayout.pdf.position, currentPracticeSplitLayout.pdf.size, setPdfViewerPosition, setPdfViewerSize])

  return {
    clampedCodingSplitX,
    currentPracticeSplitLayout,
    handleCodingSplitMouseDown,
    isCodingSplitDragging: isDragging,
    setCodingSplitX,
    snappedCodeLayout,
  }
}
