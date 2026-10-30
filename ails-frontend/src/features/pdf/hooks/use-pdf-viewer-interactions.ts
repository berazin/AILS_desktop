import { useEffect, useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from "react"
import { questionTextEntry } from "../lib/quick-chat-edit-context-types.ts"

import { savePdfPageForPath } from "../lib/pdf-page-state.ts"
import { pdfGlobalPageNavigationDirection, pdfViewZoomFromWheel } from "../../../lib/pdf-view-layout.ts"
import { inferPdfPageCount, pdfPageStorageKey, type ViewerDocument } from "../../../lib/viewer-document.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { useMarkdownMarginNavigation } from "../../document/hooks/use-markdown-margin-navigation.ts"
import type { PdfController } from "./use-pdf-controller.ts"

const PDF_VIEW_ZOOM_KEY = "ails_pdf_view_zoom"
const PDF_WHEEL_PAGE_INTERVAL_MS = 8
const PDF_WHEEL_DELTA_PER_PAGE = 90
const PDF_WHEEL_MAX_STEP = 4

type PdfViewerSibling = { path: string } | null

type UsePdfViewerInteractionsOptions = {
  coding: {
    active: boolean
    exit: () => void
    keyboardCaptured: boolean
  }
  navigation: {
    goByDelta: (delta: number) => void
    goToPage: (page: number) => void
    pageCount: number
  }
  pdf: PdfController
  viewer: {
    document: ViewerDocument | null
    fullscreen: boolean
    layoutKey: string
    scrollRef?: RefObject<HTMLElement | null>
    fullscreenScrollRef?: RefObject<HTMLElement | null>
    keyboardBlocked?: boolean
    openMaterial: (path: string, options?: { newTab?: boolean }) => void | Promise<void>
    setFullscreen: Dispatch<SetStateAction<boolean>>
    siblings: { previous: PdfViewerSibling; next: PdfViewerSibling }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function usePdfViewerInteractions({
  coding,
  navigation,
  pdf,
  viewer,
}: UsePdfViewerInteractionsOptions) {
  const {
    active: codingActive,
    exit: exitCoding,
    keyboardCaptured: codingKeyboardCaptured,
  } = coding
  const {
    goByDelta: navigateByDelta,
    goToPage: navigateToPage,
    pageCount,
  } = navigation
  const {
    document: viewerDocument,
    fullscreen,
    layoutKey,
    scrollRef,
    fullscreenScrollRef,
    keyboardBlocked,
    openMaterial,
    setFullscreen,
    siblings,
  } = viewer
  const exitCodingMode = useEventCallback(exitCoding)
  const goByDelta = useEventCallback(navigateByDelta)
  const goToPage = useEventCallback(navigateToPage)
  const openMaterialFile = useEventCallback(openMaterial)
  useMarkdownMarginNavigation({
    enabled: viewerDocument?.kind === "md" && !viewerDocument.loading && !keyboardBlocked && !codingKeyboardCaptured,
    documentId: viewerDocument?.id, containerRef: fullscreen ? fullscreenScrollRef : scrollRef,
    previousPath: siblings.previous?.path, nextPath: siblings.next?.path, onOpen: openMaterialFile,
  })
  const {
    document: {
      fullscreenPdfViewerContainerRef,
      isEditingPage,
      lastPdfAltDownAtRef,
      lastPdfWheelApplyTimeRef,
      latestPdfPageRef,
      pdfAltCheckpointRef,
      pdfPortraitByPath,
      pdfViewerContainerRef,
      pdfViewerHoverRef,
      pendingPdfWheelDeltaRef,
      pendingPdfWheelTimerRef,
      setIsPortraitPdf,
      setPdfAltCheckpointPage,
      setPdfPageByDocument,
    },
    view: {
      pdfViewZoom,
      pdfViewZoomCommitTimerRef,
      pdfViewZoomRef,
      setPdfViewZoom,
    },
  } = pdf

  useEffect(() => {
    if (!viewerDocument) return undefined
    const handleViewerArrowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      // The process-bar popover handles its own keys before the viewer's
      // window capture listener can navigate files/pages or toggle fullscreen.
      if (document.querySelector("[data-ails-document-menu-open='true']")) return
      const sandboxTarget =
        event.target instanceof HTMLElement && Boolean(event.target.closest("[data-ails-code-sandbox='true']"))
      const sandboxActive =
        document.activeElement instanceof HTMLElement
        && Boolean(document.activeElement.closest("[data-ails-code-sandbox='true']"))
      const eventTarget = event.target
      const activeElement = document.activeElement
      const isNavigationKey = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)
      const isTextEntry = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false
        return questionTextEntry(target) || target.isContentEditable
          || Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .monaco-editor"))
      }
      const isTextEntryTarget = isTextEntry(eventTarget) || isTextEntry(activeElement)
      const keyboardCaptured = codingKeyboardCaptured || sandboxTarget || sandboxActive
      const isSlideDocument = viewerDocument.kind === "pdf" || Boolean(viewerDocument.rendered_file_path)
      const pageDirection = pdfGlobalPageNavigationDirection({
        key: event.key,
        hasSlideDocument: isSlideDocument,
        textEntryActive: isTextEntryTarget,
        keyboardCaptured,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      })
      if (pageDirection !== 0) {
        event.preventDefault()
        event.stopPropagation()
        goByDelta(pageDirection)
        return
      }
      if (keyboardCaptured || isTextEntryTarget) return
      if (event.key === "Escape") {
        if (event.defaultPrevented || keyboardBlocked || event.repeat
          || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
        if (document.querySelector("[data-ails-insight-input='true']")) return
        event.preventDefault()
        event.stopPropagation()
        if (codingActive) {
          exitCodingMode()
          return
        }
        setFullscreen((current) => !current)
        return
      }
      if (!isNavigationKey) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
        && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const siblingTarget = event.key === "ArrowRight" ? siblings.next : siblings.previous
        if (!siblingTarget) return
        event.preventDefault()
        event.stopPropagation()
        void openMaterialFile(siblingTarget.path, { newTab: true })
        return
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (event.shiftKey || event.defaultPrevented || keyboardBlocked) return
        if (eventTarget instanceof Element && eventTarget.closest("[data-pdf-wheel-scroll-region], [role='menu'], [role='listbox']")) return
        if (isSlideDocument) {
          const siblingTarget = event.key === "ArrowDown" ? siblings.next : siblings.previous
          if (!siblingTarget) return
          event.preventDefault()
          event.stopPropagation()
          void openMaterialFile(siblingTarget.path)
          return
        }
        const container = fullscreen ? fullscreenScrollRef?.current : scrollRef?.current
        if (container) {
          event.preventDefault()
          event.stopPropagation()
          container.scrollTop += event.key === "ArrowDown" ? 40 : -40
        }
        return
      }
      if (event.key === "Home" || event.key === "End") {
        if (!isSlideDocument) return
        event.preventDefault()
        event.stopPropagation()
        goToPage(event.key === "Home" ? 1 : pageCount)
        return
      }
      const isNext = event.key === "ArrowRight"
      const siblingTarget = isNext ? siblings.next : siblings.previous
      if (!siblingTarget) return
      event.preventDefault()
      event.stopPropagation()
      void openMaterialFile(siblingTarget.path)
    }
    window.addEventListener("keydown", handleViewerArrowKeyDown, true)
    return () => window.removeEventListener("keydown", handleViewerArrowKeyDown, true)
  }, [
    codingActive,
    codingKeyboardCaptured,
    exitCodingMode,
    fullscreen,
    fullscreenPdfViewerContainerRef,
    fullscreenScrollRef,
    goByDelta,
    goToPage,
    layoutKey,
    keyboardBlocked,
    openMaterialFile,
    pageCount,
    pdfViewerContainerRef,
    scrollRef,
    setFullscreen,
    siblings,
    viewerDocument,
  ])

  useLayoutEffect(() => {
    pdfViewZoomRef.current = pdfViewZoom
    document.documentElement.style.setProperty("--ails-pdf-view-zoom", String(pdfViewZoom))
  }, [pdfViewZoom, pdfViewZoomRef])

  useEffect(() => () => {
    if (pdfViewZoomCommitTimerRef.current !== null) {
      window.clearTimeout(pdfViewZoomCommitTimerRef.current)
    }
  }, [pdfViewZoomCommitTimerRef])

  useEffect(() => {
    const applyPendingWheelPage = () => {
      pendingPdfWheelTimerRef.current = null
      const totalDelta = pendingPdfWheelDeltaRef.current
      pendingPdfWheelDeltaRef.current = 0
      if (!totalDelta) return
      const direction = totalDelta > 0 ? 1 : -1
      const step = Math.min(
        PDF_WHEEL_MAX_STEP,
        Math.max(1, Math.floor(Math.abs(totalDelta) / PDF_WHEEL_DELTA_PER_PAGE)),
      )
      goByDelta(direction * step)
      lastPdfWheelApplyTimeRef.current = performance.now()
    }

    const resetPendingWheel = () => {
      pendingPdfWheelDeltaRef.current = 0
      if (pendingPdfWheelTimerRef.current !== null) {
        window.clearTimeout(pendingPdfWheelTimerRef.current)
        pendingPdfWheelTimerRef.current = null
      }
    }

    const handlePdfWheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        resetPendingWheel()
        const next = pdfViewZoomFromWheel(pdfViewZoomRef.current, event.deltaY)
        pdfViewZoomRef.current = next
        document.documentElement.style.setProperty("--ails-pdf-view-zoom", String(next))
        if (pdfViewZoomCommitTimerRef.current !== null) {
          window.clearTimeout(pdfViewZoomCommitTimerRef.current)
        }
        pdfViewZoomCommitTimerRef.current = window.setTimeout(() => {
          pdfViewZoomCommitTimerRef.current = null
          localStorage.setItem(PDF_VIEW_ZOOM_KEY, String(next))
          setPdfViewZoom(next)
        }, 120)
        return
      }
      const target = event.target
      if (target instanceof Element && target.closest("[data-pdf-wheel-scroll-region]")) return

      event.preventDefault()
      pendingPdfWheelDeltaRef.current += event.deltaY
      if (pendingPdfWheelTimerRef.current !== null) return
      const now = performance.now()
      const wait = Math.max(0, PDF_WHEEL_PAGE_INTERVAL_MS - (now - lastPdfWheelApplyTimeRef.current))
      if (wait === 0) {
        applyPendingWheelPage()
        return
      }
      pendingPdfWheelTimerRef.current = window.setTimeout(applyPendingWheelPage, wait)
    }

    const normalContainer = pdfViewerContainerRef.current
    const fullscreenContainer = fullscreenPdfViewerContainerRef.current
    if (normalContainer) normalContainer.addEventListener("wheel", handlePdfWheel, { passive: false })
    if (fullscreenContainer) fullscreenContainer.addEventListener("wheel", handlePdfWheel, { passive: false })

    return () => {
      if (normalContainer) normalContainer.removeEventListener("wheel", handlePdfWheel)
      if (fullscreenContainer) fullscreenContainer.removeEventListener("wheel", handlePdfWheel)
      resetPendingWheel()
    }
  }, [
    codingActive,
    fullscreenPdfViewerContainerRef,
    lastPdfWheelApplyTimeRef,
    goByDelta,
    pdfViewZoomCommitTimerRef,
    pdfViewZoomRef,
    pdfViewerContainerRef,
    pendingPdfWheelDeltaRef,
    pendingPdfWheelTimerRef,
    setPdfViewZoom,
    fullscreen,
    layoutKey,
    viewerDocument?.id,
    viewerDocument?.kind,
  ])

  useEffect(() => {
    const clearCheckpoint = () => {
      pdfAltCheckpointRef.current = null
      setPdfAltCheckpointPage(null)
      lastPdfAltDownAtRef.current = 0
    }

    const restoreCheckpoint = () => {
      const checkpoint = pdfAltCheckpointRef.current
      if (!checkpoint) return
      pdfAltCheckpointRef.current = null
      setPdfAltCheckpointPage(null)
      if (!viewerDocument || viewerDocument.id !== checkpoint.documentId) return
      const pageCount = inferPdfPageCount(viewerDocument)
      const page = clamp(checkpoint.page, 1, pageCount)
      if (checkpoint.pathKey) savePdfPageForPath(checkpoint.pathKey, page)
      setPdfPageByDocument((current) => ({
        ...current,
        [checkpoint.documentId]: page,
        ...(checkpoint.pathKey ? { [checkpoint.pathKey]: page } : {}),
      }))
    }

    if (!viewerDocument || (viewerDocument.kind !== "pdf" && !viewerDocument.rendered_file_path)) {
      clearCheckpoint()
      return
    }
    if (pdfAltCheckpointRef.current && pdfAltCheckpointRef.current.documentId !== viewerDocument.id) {
      clearCheckpoint()
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Alt" || event.repeat) return
      if (!pdfViewerHoverRef.current || isEditingPage) return
      event.preventDefault()
      event.stopPropagation()
      const now = performance.now()
      const isDoubleTap = now - lastPdfAltDownAtRef.current <= 450
      lastPdfAltDownAtRef.current = now
      if (!isDoubleTap) return
      const pathKey = pdfPageStorageKey(viewerDocument) || ""
      if (pdfAltCheckpointRef.current) {
        lastPdfAltDownAtRef.current = 0
        restoreCheckpoint()
        return
      }
      const page = latestPdfPageRef.current
      pdfAltCheckpointRef.current = { documentId: viewerDocument.id, pathKey, page }
      setPdfAltCheckpointPage(page)
      lastPdfAltDownAtRef.current = 0
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [
    isEditingPage,
    lastPdfAltDownAtRef,
    latestPdfPageRef,
    pdfAltCheckpointRef,
    pdfViewerHoverRef,
    setPdfAltCheckpointPage,
    setPdfPageByDocument,
    viewerDocument,
  ])

  useEffect(() => {
    const pathKey = pdfPageStorageKey(viewerDocument)
    if (!viewerDocument || (viewerDocument.kind !== "pdf" && !viewerDocument.rendered_file_path)) return
    if (pathKey && Object.prototype.hasOwnProperty.call(pdfPortraitByPath, pathKey)) {
      setIsPortraitPdf(pdfPortraitByPath[pathKey])
      return
    }
    setIsPortraitPdf(true)
  }, [pdfPortraitByPath, setIsPortraitPdf, viewerDocument])
}
