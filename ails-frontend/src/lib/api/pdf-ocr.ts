import { requestJson, runPdfOperationStream } from "./core.ts"
import type { LocalAiModelStatus } from "./core.ts"

export type PdfOcrModelVariant = 'tiny' | 'small' | 'medium'
export type LegacyPdfOcrModelVariant = 'mobile' | 'server'
export type PdfOcrModelVariantWire = PdfOcrModelVariant | LegacyPdfOcrModelVariant
export type PdfOcrModelRequest = 'auto' | PdfOcrModelVariantWire

export function normalizePdfOcrModelVariant(value: unknown): PdfOcrModelVariant {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'tiny' || normalized === 'small' || normalized === 'medium') return normalized
  if (normalized === 'mobile') return 'small'
  if (normalized === 'server') return 'medium'
  return 'small'
}

export interface PdfOcrAnalysisStatus {
  pipeline?: string
  schema_version?: number
  config_hash?: string
  config_stale?: boolean
  created_at?: string
  models?: Record<string, unknown>
  payload_available?: boolean
  corrupt?: boolean
}

export interface PdfOcrStatus {
  path: string
  page_count: number
  has_text: boolean
  needs_ocr: boolean
  ocr_allowed?: boolean
  ocr_scope?: "all_pages" | "textless_slides"
  ocr_page_indexes?: number[] | null
  ocr_embedded: boolean
  ocr_embedded_version?: string
  indexed: boolean
  index_source?: string
  index_repair_required?: boolean
  language: string
  engine: string
  model_variant: PdfOcrModelVariantWire
  model_variant_raw?: string
  detection_model?: string
  recognition_model?: string
  preset_version?: string
  outline: Array<{ title: string; page: number; level: number }>
  pipeline?: string
  analysis?: PdfOcrAnalysisStatus | null
}

export interface PdfOcrFolderPreflight {
  folder_path: string
  pdf_count: number
  ocr_count: number
  skipped_text_count: number
  unreadable_count: number
  targets: Array<{ path: string; name: string; page_count: number }>
  skipped_text: Array<{ path: string; name: string; page_count: number }>
  unreadable: Array<{ path: string; name: string; error: string }>
}

export interface PdfOcrPerformanceSettings {
  logical_cpus: number
  total_memory_gb: number
  available_memory_gb: number
  gpu_provider: string | null
  batch_pages: number
  detector_batch: number
  recognition_batch: number
  render_workers: number
  prefetch_pages: number
}

export interface PdfOcrPerformanceMeasurement {
  language: string
  model_variant: PdfOcrModelVariantWire
  gpu_provider: string
  device_id: number
  batch_pages: number
  effective_batch_pages: number
  detector_batch: number
  recognition_batch: number
  render_workers: number
  seconds_per_page: number
  measured_at: string
  logical_cpus: number
  total_memory_gb: number
  detection_model: string
  recognition_model: string
  ocr_version: string
  preset_version: number | null
  benchmark_algorithm_version: number | null
  pipeline_fingerprint: string
  render_scale: number
}

export interface PdfOcrPerformanceProfileStatus {
  state: 'available' | 'missing' | 'incompatible' | 'unavailable'
  exists: boolean
  compatible: boolean
  applied: boolean
  language: string
  model_variant: PdfOcrModelVariantWire
  detection_model: string
  recognition_model: string
  ocr_version: string
  preset_version: number
  benchmark_algorithm_version: number
  pipeline_fingerprint: string
  render_scale: number
  gpu_provider: string
  cpu_available: boolean
  dependencies: PdfOcrDependencyStatus
  model: LocalAiModelStatus
  dml_device_id: number
  default_profile: PdfOcrPerformanceSettings
  measurement: PdfOcrPerformanceMeasurement | null
  stale_reason: string
  overridden: boolean
  model_selection: null | {
    benchmark_version: number
    model_variant: PdfOcrModelVariantWire
    reason: string
    measured_at: string
    candidates: Array<{
      ok: boolean
      model_variant: PdfOcrModelVariantWire
      seconds_per_page?: number
      word_count?: number
      number_count?: number
      error?: string
    }>
  }
}

export interface PdfOcrDependencyStatus {
  ready: boolean
  missing: string[]
  paddleocr_installed: boolean
  paddlex_installed: boolean
  directml_installed: boolean
  onnxruntime_installed: boolean
  installable: boolean
  runtime_packaged: boolean
  packages: string[]
}

export interface LocalModelsStatus {
  all_ready: boolean
  ocr: LocalAiModelStatus
  stt: LocalAiModelStatus & { selected_model?: string }
  video_stt?: LocalAiModelStatus & { selected_model?: string }
  voice_agent: LocalAiModelStatus
}

export interface PdfOcrWord {
  index: number
  text: string
  left: number
  top: number
  right: number
  bottom: number
  confidence: number
  block_id?: number
}

export interface PdfOcrBlock {
  block_id: number
  type: string
  left: number
  top: number
  right: number
  bottom: number
  reading_order?: number | null
  confidence?: number | null
  text_source?: string
  text?: string
}

export interface PdfOcrPage {
  page: number
  text: string
  words: PdfOcrWord[]
  blocks?: PdfOcrBlock[]
}

export interface PdfSearchResult {
  page: number
  snippet: string
}

export function getPdfOcrStatus(path: string, signal?: AbortSignal) {
  return requestJson<PdfOcrStatus>('/pdf/ocr/status', { method: 'POST', body: JSON.stringify({ path }), signal })
}

export function getPdfOcrPageCount(path: string, signal?: AbortSignal) {
  return requestJson<{ page_count: number }>('/pdf/ocr/page-count', {
    method: 'POST',
    body: JSON.stringify({ path }),
    signal,
  })
}

export function getMaterialFolderPdfOcrPreflight(folderPath: string, signal?: AbortSignal) {
  return requestJson<PdfOcrFolderPreflight>('/pdf/ocr/folder/preflight', {
    method: 'POST',
    body: JSON.stringify({ folder_path: folderPath }),
    signal,
  })
}

export type PdfOcrLanguage = 'korean' | 'en' | 'english' | 'japanese' | 'chinese'

export function getPdfOcrPerformanceProfile(
  payload: { language?: PdfOcrLanguage; model_variant?: PdfOcrModelRequest } = {},
  signal?: AbortSignal,
) {
  return requestJson<PdfOcrPerformanceProfileStatus>('/pdf/ocr/performance-profile', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function getPdfOcrPage(path: string, page: number, signal?: AbortSignal) {
  return requestJson<PdfOcrPage>('/pdf/ocr/page', {
    method: 'POST',
    body: JSON.stringify({ path, page }),
    signal,
  })
}

export function searchPdfText(path: string, query: string, signal?: AbortSignal) {
  return requestJson<{ query: string; results: PdfSearchResult[] }>('/pdf/search', {
    method: 'POST',
    body: JSON.stringify({ path, query }),
    signal,
  })
}

export interface PdfOcrStreamPayload {
  path?: string
  folder_path?: string
  language?: PdfOcrLanguage
  model_variant?: PdfOcrModelRequest
  allow_cpu?: boolean
  force?: boolean
  job_id?: string
  compare_models?: boolean
  confirmed?: boolean
  base_dir?: string
  work_acknowledged?: boolean
}

export interface PdfTranslationStreamPayload {
  path: string
  target_language?: PdfOcrLanguage
  work_acknowledged?: boolean
}

export async function runFullPdfOcrStream(
  payload: PdfOcrStreamPayload,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  return runPdfOperationStream('/pdf/ocr/full/stream', payload, onEvent, 'PDF OCR', signal)
}

export async function runMaterialFolderPdfOcrStream(
  payload: PdfOcrStreamPayload & { folder_path: string },
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  return runPdfOperationStream('/pdf/ocr/folder/stream', payload, onEvent, 'Folder PDF OCR', signal)
}

export async function downloadPdfOcrModelStream(
  payload: {
    confirmed: true
    language?: PdfOcrLanguage
    model_variant?: PdfOcrModelRequest
    allow_cpu?: boolean
  },
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  return runPdfOperationStream('/pdf/ocr/model/download/stream', payload, onEvent, 'OCR model download', signal)
}

export function getLocalModelsStatus(signal?: AbortSignal) {
  return requestJson<LocalModelsStatus>('/local/models/status', { signal })
}

export async function downloadLocalModelsPrepareStream(
  payload: {
    confirmed: true
    language?: PdfOcrLanguage
    model_variant?: PdfOcrModelRequest
    allow_cpu?: boolean
  } = { confirmed: true },
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  return runPdfOperationStream('/local/models/prepare/stream', payload, onEvent, 'Local models prepare', signal)
}

export async function benchmarkPdfOcrStream(
  payload: PdfOcrStreamPayload,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  return runPdfOperationStream('/pdf/ocr/benchmark/stream', payload, onEvent, 'PDF OCR benchmark', signal)
}

export function cancelPdfOcrJob(jobId: string, signal?: AbortSignal) {
  return requestJson<{ job_id: string; cancelled: boolean; status: string }>('/pdf/ocr/cancel', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId }),
    signal,
  })
}

export async function runPdfTranslationStream(
  payload: PdfTranslationStreamPayload,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  return runPdfOperationStream('/pdf/translate/stream', payload, onEvent, 'PDF translation', signal)
}

export function cancelPdfTranslation(path: string, signal?: AbortSignal) {
  return requestJson<{ path: string; cancelled: boolean }>('/pdf/translate/cancel', {
    method: 'POST',
    body: JSON.stringify({ path }),
    signal,
  })
}
