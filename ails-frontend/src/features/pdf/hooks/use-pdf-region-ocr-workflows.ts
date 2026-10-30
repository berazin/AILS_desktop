import { useEffect, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react"

import { extractPdfRegionText } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import type { PdfController, PdfOcrDragSelection, PdfOcrPoint } from "./use-pdf-controller.ts"

export const PDF_OCR_HINT_DISMISSED_KEY = "ails_pdf_ocr_hint_dismissed"

type ClientRectLike = {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

type UsePdfRegionOcrWorkflowsOptions = {
  pdf: PdfController
  document: {
    captureOcrTarget?: () => ((text: string) => boolean) | null
    canDragText: boolean
    codingModeActive: boolean
    currentPage: number
    getContainedImageRect: (image: HTMLImageElement | HTMLDivElement) => ClientRectLike
    goToPage: (direction: -1 | 1) => void
    pageCount: number
    source: { page: number; path: string; title: string } | null
    viewerId: string
  }
  interaction: {
    setNotice: (message: string) => void
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function usePdfRegionOcrWorkflows({
  pdf,
  document,
  interaction,
}: UsePdfRegionOcrWorkflowsOptions) {
  const {
    document: { pdfViewerContainerRef },
    ocr: {
      isPdfRegionOcrBusy, pdfOcrDidDragRef, pdfOcrRequestIdRef, pdfOcrSelectionRef,
      pdfRegionOcrAbortRef, pdfSuppressNextClickRef, setCodeSandboxOcrInsertRequest,
      setIsPdfOcrHintDismissed, setIsPdfRegionOcrBusy, setPdfOcrSelection,
    },
  } = pdf
  const {
    canDragText, codingModeActive, currentPage, getContainedImageRect, goToPage,
    pageCount, source, viewerId,
  } = document
  const { setNotice } = interaction

  function pdfOcrPointFromPointer(
    event: ReactPointerEvent<HTMLDivElement>,
    clampToImage = true,
  ): PdfOcrPoint | null {
    const viewer = pdfViewerContainerRef.current
    if (!viewer) return null
    const imageRect = getContainedImageRect(event.currentTarget)
    if (!clampToImage && (
      event.clientX < imageRect.left
      || event.clientX > imageRect.right
      || event.clientY < imageRect.top
      || event.clientY > imageRect.bottom
    )) {
      return null
    }
    const clientX = clamp(event.clientX, imageRect.left, imageRect.right)
    const clientY = clamp(event.clientY, imageRect.top, imageRect.bottom)
    const viewerRect = viewer.getBoundingClientRect()
    return {
      normalizedX: clamp((clientX - imageRect.left) / Math.max(imageRect.width, 1), 0, 1),
      normalizedY: clamp((clientY - imageRect.top) / Math.max(imageRect.height, 1), 0, 1),
      viewerX: clientX - viewerRect.left,
      viewerY: clientY - viewerRect.top,
    }
  }

  async function submitPdfOcrSelection(selection: PdfOcrDragSelection) {
    if (!source?.path || isPdfRegionOcrBusy) return
    const left = Math.min(selection.start.normalizedX, selection.current.normalizedX)
    const top = Math.min(selection.start.normalizedY, selection.current.normalizedY)
    const right = Math.max(selection.start.normalizedX, selection.current.normalizedX)
    const bottom = Math.max(selection.start.normalizedY, selection.current.normalizedY)
    const widthPixels = Math.abs(selection.current.viewerX - selection.start.viewerX)
    const heightPixels = Math.abs(selection.current.viewerY - selection.start.viewerY)
    if (widthPixels < 10 || heightPixels < 10 || right - left < 0.005 || bottom - top < 0.005) {
      pdfOcrSelectionRef.current = null
      setPdfOcrSelection(null)
      setNotice(t("가져올 영역을 조금 더 크게 드래그해 주세요."))
      return
    }

    setIsPdfOcrHintDismissed(true)
    localStorage.setItem(PDF_OCR_HINT_DISMISSED_KEY, "true")

    const folderTarget = document.captureOcrTarget?.()
    if (document.captureOcrTarget && !folderTarget) {
      setNotice(t("먼저 코드 편집기에서 파일을 여세요."))
      pdfOcrSelectionRef.current = null
      setPdfOcrSelection(null)
      return
    }
    const controller = new AbortController()
    pdfRegionOcrAbortRef.current?.abort()
    pdfRegionOcrAbortRef.current = controller
    setIsPdfRegionOcrBusy(true)
    try {
      const result = await extractPdfRegionText(
        {
          path: source.path,
          page: selection.page,
          region: { left, top, right, bottom },
        },
        controller.signal,
      )
      if (controller.signal.aborted) return
      if (!result.text?.trim()) {
        setNotice(t("선택 영역에 텍스트가 없습니다."))
        return
      }
      if (folderTarget) {
        if (!folderTarget(result.text)) { setNotice(t("대상 코드 파일이 변경되었습니다. 파일을 선택하고 다시 가져오세요.")); return }
      } else {
        pdfOcrRequestIdRef.current += 1
        setCodeSandboxOcrInsertRequest({
          id: pdfOcrRequestIdRef.current,
          text: result.text,
          page: result.page ?? selection.page,
        })
      }
      setNotice(t("PDF {p0}페이지의 텍스트를 옮겼습니다.", { p0: result.page ?? selection.page }))
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(t("텍스트 가져오기 실패: {p0}", { p0: getErrorMessage(error) }))
      }
    } finally {
      if (pdfRegionOcrAbortRef.current === controller) {
        pdfRegionOcrAbortRef.current = null
        pdfOcrSelectionRef.current = null
        setPdfOcrSelection(null)
        setIsPdfRegionOcrBusy(false)
      }
    }
  }

  function handlePdfOcrPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canDragText || isPdfRegionOcrBusy || event.button !== 0) return
    const point = pdfOcrPointFromPointer(event, false)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    pdfOcrDidDragRef.current = false
    const page = Number(event.currentTarget.dataset.pdfPageNumber) || currentPage
    const selection = { pointerId: event.pointerId, page, start: point, current: point }
    pdfOcrSelectionRef.current = selection
    setPdfOcrSelection(selection)
  }

  function handlePdfOcrPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const selection = pdfOcrSelectionRef.current
    if (!selection || selection.pointerId !== event.pointerId || isPdfRegionOcrBusy) return
    const point = pdfOcrPointFromPointer(event)
    if (!point) return
    event.preventDefault()
    if (Math.hypot(point.viewerX - selection.start.viewerX, point.viewerY - selection.start.viewerY) >= 5) {
      pdfOcrDidDragRef.current = true
    }
    const next = { ...selection, current: point }
    pdfOcrSelectionRef.current = next
    setPdfOcrSelection(next)
  }

  function handlePdfOcrPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const selection = pdfOcrSelectionRef.current
    if (!selection || selection.pointerId !== event.pointerId || isPdfRegionOcrBusy) return
    const point = pdfOcrPointFromPointer(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!pdfOcrDidDragRef.current) {
      pdfOcrSelectionRef.current = null
      setPdfOcrSelection(null)
      const rect = event.currentTarget.getBoundingClientRect()
      const direction = event.clientX < rect.left + rect.width / 2 ? -1 : 1
      pdfSuppressNextClickRef.current = true
      window.setTimeout(() => {
        pdfSuppressNextClickRef.current = false
      }, 0)
      if ((direction < 0 && currentPage > 1) || (direction > 0 && currentPage < pageCount)) {
        goToPage(direction)
      }
      return
    }
    const completed = { ...selection, current: point }
    pdfOcrSelectionRef.current = completed
    setPdfOcrSelection(completed)
    void submitPdfOcrSelection(completed)
  }

  function handlePdfOcrPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const selection = pdfOcrSelectionRef.current
    if (!selection || selection.pointerId !== event.pointerId || isPdfRegionOcrBusy) return
    pdfOcrSelectionRef.current = null
    setPdfOcrSelection(null)
  }

  function handlePdfImageClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (pdfSuppressNextClickRef.current) {
      pdfSuppressNextClickRef.current = false
      return
    }
    if (pdfOcrDidDragRef.current) {
      pdfOcrDidDragRef.current = false
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const direction = event.clientX < rect.left + rect.width / 2 ? -1 : 1
    if ((direction < 0 && currentPage <= 1) || (direction > 0 && currentPage >= pageCount)) return
    goToPage(direction)
  }

  useEffect(() => {
    pdfRegionOcrAbortRef.current?.abort()
    pdfRegionOcrAbortRef.current = null
    pdfOcrSelectionRef.current = null
    setPdfOcrSelection(null)
    setIsPdfRegionOcrBusy(false)
  }, [codingModeActive, currentPage, pdfOcrSelectionRef, pdfRegionOcrAbortRef, setIsPdfRegionOcrBusy, setPdfOcrSelection, viewerId])

  return {
    handlePdfImageClick,
    handlePdfOcrPointerCancel,
    handlePdfOcrPointerDown,
    handlePdfOcrPointerMove,
    handlePdfOcrPointerUp,
  }
}
