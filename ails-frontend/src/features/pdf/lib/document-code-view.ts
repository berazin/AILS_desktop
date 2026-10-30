import { viewerDocumentIsPdf, type ViewerDocument } from "../../../lib/viewer-document.ts"
import type { PdfController } from "../hooks/use-pdf-controller.ts"

type Ports = { pdf: PdfController; setFloating: (open: boolean) => void }

export function prepareDocumentCodeView(document: ViewerDocument, { pdf, setFloating }: Ports): number | null {
  const { view, document: state } = pdf
  const page = state.latestPdfPageRef.current
  let aspect: number | null = null
  if (viewerDocumentIsPdf(document)) {
    for (const container of [state.fullscreenPdfViewerContainerRef.current, state.pdfViewerContainerRef.current]) {
      const layer = container?.querySelector<HTMLElement>(`[data-pdf-page-number="${page}"]`)
      if (!layer) continue
      const bounds = layer.getBoundingClientRect()
      if (!bounds.width || !bounds.height) continue
      aspect = (parseFloat(layer.style.width) || bounds.width) / (parseFloat(layer.style.height) || bounds.height)
      break
    }
    if (["ppt", "pptx"].includes(document.kind)) {
      view.setPresentationPageLayout("single")
      localStorage.setItem("ails_presentation_page_layout", "single")
    } else {
      view.setPdfPageLayout("single")
      localStorage.setItem("ails_pdf_page_layout", "single")
    }
    window.clearTimeout(view.pdfViewZoomCommitTimerRef.current ?? undefined)
    view.pdfViewZoomCommitTimerRef.current = null
    view.pdfViewZoomRef.current = 1
    view.setPdfViewZoom(1)
    localStorage.setItem("ails_pdf_view_zoom", "1")
  }
  setFloating(false)
  return aspect
}
