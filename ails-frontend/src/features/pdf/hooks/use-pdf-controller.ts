import { usePdfAnnotationState } from './use-pdf-annotation-state.ts'
import { usePdfDocumentState } from './use-pdf-document-state.ts'
import { usePdfOcrState } from './use-pdf-ocr-state.ts'
import { usePdfStudyState } from './use-pdf-study-state.ts'
import { usePdfTranslationState } from './use-pdf-translation-state.ts'
import { usePdfViewState } from './use-pdf-view-state.ts'

export type { PdfOcrPoint, PdfOcrDragSelection, PdfAnnotationHistoryEntry, PdfOcrProgress, PdfOcrPerformance, PdfOcrJob } from '../lib/pdf-controller-types.ts'

type UsePdfControllerOptions = { readSavedPages: () => Record<string, number> }

// Preserve the public controller contract while each domain owns its state.
export function usePdfController({ readSavedPages }: UsePdfControllerOptions) {
  const annotation = usePdfAnnotationState()
  const document = usePdfDocumentState(readSavedPages)
  const ocr = usePdfOcrState()
  const study = usePdfStudyState()
  const translation = usePdfTranslationState()
  const view = usePdfViewState()
  return { annotation, document, ocr, study, translation, view }
}

export type PdfController = ReturnType<typeof usePdfController>
