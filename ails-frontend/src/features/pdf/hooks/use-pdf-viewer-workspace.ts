import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"

import { pdfSpreadPages } from "../../../lib/pdf-view-layout.ts"
import {
  inferPdfPageCount,
  pdfPageStorageKey,
  type ViewerDocument,
} from "../../../lib/viewer-document.ts"
import { containedImageClientRect } from "../../../lib/viewer-editing.ts"
import {
  usePdfAnnotationDocumentWorkflow,
} from "./use-pdf-annotation-workflows.ts"
import type { PdfController } from "./use-pdf-controller.ts"
import { usePdfNavigationWorkflows } from "./use-pdf-navigation-workflows.ts"
import { usePdfRegionOcrWorkflows } from "./use-pdf-region-ocr-workflows.ts"
import { normalizedMaterialPath } from "../../../lib/material-navigation.ts"
import { pdfOcrConfirmationTextState } from "../lib/pdf-ocr-confirmation.ts"

type UsePdfViewerWorkspaceOptions = {
  annotationPalette: {
    containerRef: RefObject<HTMLDivElement | null>
    open: boolean
    setOpen: Dispatch<SetStateAction<boolean>>
  }
  coding: {
    alongsideIde?: boolean
    singlePageOnly?: boolean
    folderOcrActive?: boolean
    captureOcrTarget?: () => ((text: string) => boolean) | null
    active: boolean
    activeSandboxBaseDir: string
    sandboxOpen: boolean
    setPageAspect: (aspect: number) => void
  }
  document: ViewerDocument | null
  pdf: PdfController
  problemBaseDir: string
  quickChat: {
    blocked: boolean
    draftRef: RefObject<string>
    setOpen: Dispatch<SetStateAction<boolean>>
  }
  resolvedTheme?: string
  setNotice: (notice: string) => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function usePdfViewerWorkspace({
  annotationPalette,
  coding,
  document: viewerDocument,
  pdf,
  problemBaseDir,
  quickChat,
  resolvedTheme,
  setNotice,
}: UsePdfViewerWorkspaceOptions) {
  const {
    document: {
      isPortraitPdf,
      latestPdfPageRef,
      pageInputDraft,
      pdfPageByDocument,
      pdfPortraitByPath,
      pdfViewerContainerRef,
      pdfViewerHoverRef,
      setIsEditingPage,
      setIsPortraitPdf,
      setPdfPageByDocument,
      setPdfPortraitByPath,
    },
    ocr: {
      pdfFullOcrStatus,
      pdfOcrConfirmPath,
    },
    view: {
      pdfColorMode,
      pdfPageLayout,
      pdfSpreadSide,
      pdfViewZoom,
      presentationPageLayout,
    },
  } = pdf
  const {
    active: practiceActive,
    activeSandboxBaseDir,
    sandboxOpen,
    setPageAspect,
  } = coding
  const codingModeActive = practiceActive && !coding.alongsideIde
  const {
    containerRef: annotationPaletteRef,
    open: annotationPaletteOpen,
    setOpen: setAnnotationPaletteOpen,
  } = annotationPalette
  const {
    blocked: quickChatBlocked,
    draftRef: chatInputDraftRef,
    setOpen: setPdfQuickChatOpen,
  } = quickChat
  const codingPdfImageRef = useRef<HTMLDivElement | null>(null)
  const [codingPdfPageRect, setCodingPdfPageRect] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const [codingPdfRenderedKey, setCodingPdfRenderedKey] = useState("")

  const viewerHasRenderedSlides = Boolean(viewerDocument?.rendered_file_path)
  const presentationViewerActive = Boolean(
    viewerDocument && ["ppt", "pptx"].includes(viewerDocument.kind) && viewerHasRenderedSlides,
  )
  const activePageLayout = coding.singlePageOnly ? "single" : presentationViewerActive ? presentationPageLayout : pdfPageLayout
  const nonSlideCodingViewer = codingModeActive
    && viewerDocument
    && viewerDocument.kind !== "pdf"
    && !viewerHasRenderedSlides
  const studyViewerActive = Boolean(
    viewerDocument && (viewerDocument.kind === "pdf" || viewerHasRenderedSlides) && !codingModeActive,
  )
  const pageCount = inferPdfPageCount(viewerDocument)
  const pagePathKey = pdfPageStorageKey(viewerDocument)
  const usesPortraitLayout = pagePathKey && Object.prototype.hasOwnProperty.call(pdfPortraitByPath, pagePathKey)
    ? pdfPortraitByPath[pagePathKey]
    : isPortraitPdf
  const currentPage = viewerDocument && (viewerDocument.kind === "pdf" || viewerHasRenderedSlides)
    ? clamp(
        pdfPageByDocument[viewerDocument.id]
          ?? (pagePathKey ? pdfPageByDocument[pagePathKey] : undefined)
          ?? 1,
        1,
        pageCount,
      )
    : 1
  const spreadActive = activePageLayout === "spread"
    && !codingModeActive
    && Boolean(viewerDocument && (viewerDocument.kind === "pdf" || viewerHasRenderedSlides))
  const visiblePageNumbers: readonly (number | null)[] = useMemo(
    () => spreadActive ? pdfSpreadPages(currentPage, pageCount, pdfSpreadSide) : [currentPage],
    [currentPage, pageCount, pdfSpreadSide, spreadActive],
  )
  const visiblePages = visiblePageNumbers.filter((page): page is number => page != null)
  const pageLabel = `${visiblePages.join("–")} / ${pageCount}`
  const themeInvertEnabled = pdfColorMode === "theme" && resolvedTheme === "dark"
  const activePath = viewerDocument && (viewerDocument.kind === "pdf" || viewerHasRenderedSlides)
    ? (viewerDocument.rendered_file_path || viewerDocument.file_path || "")
    : ""

  const navigation = usePdfNavigationWorkflows({
    document: viewerDocument
      ? {
          id: viewerDocument.id,
          isPdfViewer: viewerDocument.kind === "pdf" || Boolean(viewerDocument.rendered_file_path),
          pageCount,
          pathKey: pagePathKey,
        }
      : null,
    input: {
      draft: pageInputDraft,
      setEditing: setIsEditingPage,
    },
    navigation: {
      codingModeActive,
      layout: activePageLayout,
      spreadSide: pdfSpreadSide,
    },
    pageState: {
      latestPageRef: latestPdfPageRef,
      setPages: setPdfPageByDocument,
      viewerHoverRef: pdfViewerHoverRef,
    },
  })

  useEffect(() => {
    if (!annotationPaletteOpen) return undefined
    const closePalette = (event: PointerEvent) => {
      if (!annotationPaletteRef.current?.contains(event.target as Node)) setAnnotationPaletteOpen(false)
    }
    document.addEventListener("pointerdown", closePalette, true)
    return () => document.removeEventListener("pointerdown", closePalette, true)
  }, [annotationPaletteOpen, annotationPaletteRef, setAnnotationPaletteOpen])

  usePdfAnnotationDocumentWorkflow(pdf, activePath)

  useEffect(() => {
    setAnnotationPaletteOpen(false)
  }, [activePath, setAnnotationPaletteOpen])

  useEffect(() => {
    if (!studyViewerActive || !activePath || quickChatBlocked) return
    if (!chatInputDraftRef.current.trim()) setPdfQuickChatOpen(false)
  }, [
    activePath,
    chatInputDraftRef,
    quickChatBlocked,
    setPdfQuickChatOpen,
    studyViewerActive,
  ])

  const activeProblemSourceKey = activePath && problemBaseDir
    ? `${normalizedMaterialPath(activePath).toLocaleLowerCase()}\u0000${normalizedMaterialPath(problemBaseDir).toLocaleLowerCase()}`
    : ""
  const activePathRef = useRef(activePath)
  const activeProblemSourceKeyRef = useRef(activeProblemSourceKey)
  useLayoutEffect(() => {
    activePathRef.current = activePath
    activeProblemSourceKeyRef.current = activeProblemSourceKey
  }, [activePath, activeProblemSourceKey])

  const sandboxBaseMatchesPdf = Boolean(
    activePath
      && problemBaseDir
      && normalizedMaterialPath(activeSandboxBaseDir).toLocaleLowerCase()
        === normalizedMaterialPath(problemBaseDir).toLocaleLowerCase(),
  )
  const pdfPracticeContextActive = Boolean(
    activePath && problemBaseDir && (codingModeActive || !sandboxOpen || sandboxBaseMatchesPdf),
  )
  const codingPageKey = `${activePath}\u0000${currentPage}`
  const handleCodingImageGeometryLoaded = useCallback(({ aspect, portrait }: {
    aspect: number | null
    portrait: boolean
  }) => {
    if (aspect !== null) setPageAspect(aspect)
    setIsPortraitPdf(portrait)
    if (pagePathKey) {
      setPdfPortraitByPath((current) => (
        current[pagePathKey] === portrait ? current : { ...current, [pagePathKey]: portrait }
      ))
    }
  }, [pagePathKey, setIsPortraitPdf, setPageAspect, setPdfPortraitByPath])
  const ocrStatusMatchesActivePath = Boolean(
    activePath
      && pdfFullOcrStatus?.path
      && normalizedMaterialPath(pdfFullOcrStatus.path).toLocaleLowerCase()
        === normalizedMaterialPath(activePath).toLocaleLowerCase(),
  )
  const ocrStatusMatchesConfirmPath = Boolean(
    pdfOcrConfirmPath
      && pdfFullOcrStatus?.path
      && normalizedMaterialPath(pdfFullOcrStatus.path).toLocaleLowerCase()
        === normalizedMaterialPath(pdfOcrConfirmPath).toLocaleLowerCase(),
  )
  const ocrConfirmTextState = pdfOcrConfirmationTextState(ocrStatusMatchesConfirmPath ? pdfFullOcrStatus : null)
  const ocrConfirmNeedsIndexRepair = ocrConfirmTextState === "repair"
  const ocrConfirmRerunsExistingText = ocrConfirmTextState === "existing_text"
  const canDragText = Boolean(
    !codingModeActive && coding.folderOcrActive && ocrStatusMatchesActivePath && pdfFullOcrStatus?.has_text,
  )

  const updateCodingPageRect = useCallback(() => {
    const image = codingPdfImageRef.current
    const viewer = pdfViewerContainerRef.current
    if (
      !image
      || !viewer
    ) {
      setCodingPdfPageRect({ left: 0, top: 0, width: 0, height: 0 })
      return
    }
    const imageRect = containedImageClientRect(image)
    const viewerRect = viewer.getBoundingClientRect()
    setCodingPdfPageRect({
      left: imageRect.left - viewerRect.left,
      top: imageRect.top - viewerRect.top,
      width: imageRect.width,
      height: imageRect.height,
    })
  }, [pdfViewerContainerRef])

  useEffect(() => {
    setCodingPdfPageRect({ left: 0, top: 0, width: 0, height: 0 })
  }, [codingPageKey])

  useEffect(() => {
    if (!codingModeActive) {
      setCodingPdfPageRect({ left: 0, top: 0, width: 0, height: 0 })
      return
    }
    const viewer = pdfViewerContainerRef.current
    const image = codingPdfImageRef.current
    if (!viewer || !image) return
    const observer = new ResizeObserver(() => updateCodingPageRect())
    observer.observe(viewer)
    observer.observe(image)
    const frame = window.requestAnimationFrame(updateCodingPageRect)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [codingModeActive, currentPage, pdfViewZoom, pdfViewerContainerRef, updateCodingPageRect])

  const codeSandboxSlideCodeSource = useMemo(() => {
    if ((!codingModeActive && !coding.folderOcrActive) || !viewerDocument || !(viewerDocument.kind === "pdf" || viewerHasRenderedSlides)) return null
    const path = viewerDocument.rendered_file_path || viewerDocument.file_path
    if (!path) return null
    return {
      path,
      page: currentPage,
      title: viewerDocument.title,
    }
  }, [codingModeActive, coding.folderOcrActive, currentPage, viewerDocument, viewerHasRenderedSlides])

  const regionOcr = usePdfRegionOcrWorkflows({
    pdf,
    document: {
      canDragText,
      captureOcrTarget: coding.captureOcrTarget,
      codingModeActive,
      currentPage,
      getContainedImageRect: containedImageClientRect,
      goToPage: navigation.goByDirection,
      pageCount,
      source: codeSandboxSlideCodeSource,
      viewerId: viewerDocument?.id ?? "",
    },
    interaction: { setNotice },
  })

  useLayoutEffect(() => {
    latestPdfPageRef.current = currentPage
  }, [currentPage, latestPdfPageRef, viewerDocument?.id])

  return {
    coding: {
      active: codingModeActive,
      canDragText,
      imageRef: codingPdfImageRef,
      onGeometryLoaded: handleCodingImageGeometryLoaded,
      pageKey: codingPageKey,
      pageRect: codingPdfPageRect,
      regionOcr,
      renderedKey: codingPdfRenderedKey,
      setRenderedKey: setCodingPdfRenderedKey,
      updatePageRect: updateCodingPageRect,
    },
    document: {
      activePageLayout,
      activePath,
      currentPage,
      nonSlideCodingViewer,
      pageCount,
      pageLabel,
      pagePathKey,
      presentationViewerActive,
      spreadActive,
      singlePageOnly: coding.singlePageOnly ?? false,
      studyViewerActive,
      themeInvertEnabled,
      usesPortraitLayout,
      viewerHasRenderedSlides,
      visiblePageNumbers,
      visiblePages,
    },
    navigation,
    ocr: {
      confirmTextState: ocrConfirmTextState,
      confirmNeedsIndexRepair: ocrConfirmNeedsIndexRepair,
      confirmRerunsExistingText: ocrConfirmRerunsExistingText,
      statusMatchesActivePath: ocrStatusMatchesActivePath,
    },
    practice: {
      active: pdfPracticeContextActive,
      activeProblemSourceKey,
      activeProblemSourceKeyRef,
      activePathRef,
      baseDir: problemBaseDir,
    },
  }
}

export type PdfViewerWorkspace = ReturnType<typeof usePdfViewerWorkspace>
