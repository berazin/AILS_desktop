import type { PdfAnnotationMode, PdfAnnotationSettings } from "./pdf-annotation-layer.tsx"
import { PdfAnnotationLayer } from "./pdf-annotation-layer.tsx"
import { loadPdfOcrPageWords } from "./pdf-ocr-text-layer-data.ts"
import { PdfOcrTextLayer } from "./pdf-ocr-text-layer.tsx"
import { PdfProblemMarkers } from "./pdf-problem-markers.tsx"
import { PdfSearchHighlightLayer } from "./pdf-search-highlight-layer.tsx"
import type { PdfAnnotation, PdfProblem } from "../../../lib/api"
import { pdfProblemsOnPage } from "../../../lib/problem-study.ts"

type PdfPageOverlayProps = {
  activePath: string
  annotationMode: PdfAnnotationMode
  annotationSettings: PdfAnnotationSettings
  annotations: PdfAnnotation[]
  large?: boolean
  onCommitAnnotation: (annotation: PdfAnnotation) => void
  onDeleteAnnotation: (annotationId: string) => void
  onSelectProblem: (problem: PdfProblem) => void
  page: number
  pageCount: number
  problems: PdfProblem[]
  searchHighlight?: { path: string; query: string }
  textVisible: boolean
}

export function PdfPageOverlay({
  activePath,
  annotationMode,
  annotationSettings,
  annotations,
  large,
  onCommitAnnotation,
  onDeleteAnnotation,
  onSelectProblem,
  page,
  pageCount,
  problems,
  searchHighlight,
  textVisible,
}: PdfPageOverlayProps) {
  return (
    <>
      <PdfSearchHighlightLayer
        page={page}
        path={activePath}
        query={searchHighlight && searchHighlight.path === activePath ? searchHighlight.query : ""}
      />
      <PdfOcrTextLayer
        page={page}
        pageCount={pageCount}
        path={activePath}
        visible={textVisible}
      />
      <PdfProblemMarkers
        large={large}
        onSelect={onSelectProblem}
        problems={pdfProblemsOnPage(problems, page)}
      />
      <PdfAnnotationLayer
        annotations={annotations}
        loadWords={loadPdfOcrPageWords}
        mode={annotationMode}
        onCommit={onCommitAnnotation}
        onDelete={onDeleteAnnotation}
        page={page}
        pdfPath={activePath}
        settings={annotationSettings}
      />
    </>
  )
}
