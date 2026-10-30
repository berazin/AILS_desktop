import { useMemo } from "react"

import { PdfPageOverlay } from "../components/pdf-page-overlay.tsx"
import type { PdfAnnotation, PdfProblem } from "../../../lib/api"
import type { PdfController } from "./use-pdf-controller.ts"

type UsePdfPageOverlaysOptions = {
  activePath: string
  onCommitAnnotation: (annotation: PdfAnnotation) => void
  onDeleteAnnotation: (annotationId: string) => void
  onSelectProblem: (problem: PdfProblem) => void
  pageCount: number
  pdf: PdfController
  problems: PdfProblem[]
}

export function usePdfPageOverlays({
  activePath,
  onCommitAnnotation,
  onDeleteAnnotation,
  onSelectProblem,
  pageCount,
  pdf,
  problems,
}: UsePdfPageOverlaysOptions) {
  const {
    annotation: {
      pdfAnnotationMode,
      pdfAnnotationSettings,
      pdfAnnotations,
    },
    view: { pdfOcrTextVisible, pdfSearchHighlight },
  } = pdf

  const viewer = useMemo(
    () => (page: number) => (
      <PdfPageOverlay
        activePath={activePath}
        annotationMode={pdfAnnotationMode}
        annotationSettings={pdfAnnotationSettings}
        annotations={pdfAnnotations}
        onCommitAnnotation={onCommitAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onSelectProblem={onSelectProblem}
        page={page}
        pageCount={pageCount}
        problems={problems}
        searchHighlight={pdfSearchHighlight}
        textVisible={pdfOcrTextVisible}
      />
    ),
    [activePath, onCommitAnnotation, onDeleteAnnotation, onSelectProblem, pageCount, pdfAnnotationMode, pdfAnnotationSettings, pdfAnnotations, pdfOcrTextVisible, pdfSearchHighlight, problems],
  )
  const fullscreen = useMemo(
    () => (page: number) => (
      <PdfPageOverlay
        activePath={activePath}
        annotationMode={pdfAnnotationMode}
        annotationSettings={pdfAnnotationSettings}
        annotations={pdfAnnotations}
        large
        onCommitAnnotation={onCommitAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onSelectProblem={onSelectProblem}
        page={page}
        pageCount={pageCount}
        problems={problems}
        searchHighlight={pdfSearchHighlight}
        textVisible={pdfOcrTextVisible}
      />
    ),
    [activePath, onCommitAnnotation, onDeleteAnnotation, onSelectProblem, pageCount, pdfAnnotationMode, pdfAnnotationSettings, pdfAnnotations, pdfOcrTextVisible, pdfSearchHighlight, problems],
  )

  return { fullscreen, viewer }
}

export type PdfPageOverlays = ReturnType<typeof usePdfPageOverlays>
