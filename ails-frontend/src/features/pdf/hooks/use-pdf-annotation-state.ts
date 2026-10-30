import { useRef, useState } from 'react'
import type { PdfAnnotation } from '../../../lib/api'
import type { PdfAnnotationMode, PdfAnnotationSettings } from '../components/pdf-annotation-layer.tsx'
import type { PdfAnnotationHistoryEntry } from '../lib/pdf-controller-types.ts'

const PDF_ANNOTATION_SETTINGS_KEY = "ails_pdf_annotation_settings_v1"

const DEFAULT_PDF_ANNOTATION_SETTINGS: PdfAnnotationSettings = {
  color: "#ef4444",
  strokeWidth: 3,
  fontSize: 16,
  shapeCorrection: true,
  shapeHoldMs: 500,
}

function readPdfAnnotationSettings(): PdfAnnotationSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(PDF_ANNOTATION_SETTINGS_KEY) || "{}") as Partial<PdfAnnotationSettings>
    return {
      color: /^#[0-9a-f]{6}$/i.test(saved.color || "") ? saved.color! : DEFAULT_PDF_ANNOTATION_SETTINGS.color,
      strokeWidth: Number.isFinite(saved.strokeWidth) && saved.strokeWidth! >= 1 && saved.strokeWidth! <= 12
        ? saved.strokeWidth!
        : DEFAULT_PDF_ANNOTATION_SETTINGS.strokeWidth,
      fontSize: Number.isFinite(saved.fontSize) && saved.fontSize! >= 10 && saved.fontSize! <= 36
        ? saved.fontSize!
        : DEFAULT_PDF_ANNOTATION_SETTINGS.fontSize,
      shapeCorrection: saved.shapeCorrection !== false,
      shapeHoldMs: Number.isFinite(saved.shapeHoldMs) && saved.shapeHoldMs! >= 300 && saved.shapeHoldMs! <= 1000
        ? saved.shapeHoldMs!
        : DEFAULT_PDF_ANNOTATION_SETTINGS.shapeHoldMs,
    }
  } catch {
    return DEFAULT_PDF_ANNOTATION_SETTINGS
  }
}

// This hook owns annotation state; other PDF domains interact through its returned contract.
export function usePdfAnnotationState() {
  const [pdfAnnotationMode, setPdfAnnotationMode] = useState<PdfAnnotationMode>("default")
  const [pdfAnnotationSettings, setPdfAnnotationSettings] = useState(readPdfAnnotationSettings)
  const [pdfAnnotations, setPdfAnnotations] = useState<PdfAnnotation[]>([])
  const pdfAnnotationsRef = useRef<PdfAnnotation[]>([])
  const [pdfAnnotationError, setPdfAnnotationError] = useState("")
  const [pdfAnnotationUndo, setPdfAnnotationUndo] = useState<PdfAnnotationHistoryEntry[]>([])
  const [pdfAnnotationRedo, setPdfAnnotationRedo] = useState<PdfAnnotationHistoryEntry[]>([])
  const pdfAnnotationPendingRef = useRef<Map<string, PdfAnnotation | null>>(new Map())
  const [pdfAnnotationPendingCount, setPdfAnnotationPendingCount] = useState(0)
  const activePdfAnnotationPathRef = useRef("")

  return {
    activePdfAnnotationPathRef, pdfAnnotationError, pdfAnnotationMode, pdfAnnotationPendingCount,
    pdfAnnotationPendingRef, pdfAnnotationRedo, pdfAnnotationSettings, pdfAnnotations, pdfAnnotationsRef,
    pdfAnnotationUndo, setPdfAnnotationError, setPdfAnnotationMode, setPdfAnnotationPendingCount,
    setPdfAnnotationRedo, setPdfAnnotationSettings, setPdfAnnotations, setPdfAnnotationUndo,
  }
}
