import type { PdfAnnotation } from '../../../lib/api'

export type PdfOcrPoint = {
  normalizedX: number
  normalizedY: number
  viewerX: number
  viewerY: number
}

export type PdfOcrDragSelection = {
  pointerId: number
  page: number
  start: PdfOcrPoint
  current: PdfOcrPoint
}

export type PdfAnnotationHistoryEntry = {
  before: PdfAnnotation | null
  after: PdfAnnotation | null
}

export type PdfOcrProgress = {
  page: number
  total: number
  unit?: "page" | "file"
}

export type PdfOcrPerformance = {
  batchPages: number
  detectorBatch: number
  recognitionBatch: number
  renderWorkers: number
  gpuProvider: string
  modelVariant: "tiny" | "small" | "medium"
}

export type PdfOcrJob = {
  jobId: string
  path: string
  title: string
  phase: string
  progress: PdfOcrProgress
  performance: PdfOcrPerformance | null
  cancelPending: boolean
}
