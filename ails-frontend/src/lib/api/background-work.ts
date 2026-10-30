import { requestJson } from "./core.ts"

export interface BackgroundWorkStatus {
  settings?: {
    embedding_enabled?: boolean
    spacing_enabled?: boolean
    spacing_non_ails?: boolean
    ocr_enabled?: boolean
    ocr_non_ails?: boolean
    language?: string
    base_dir?: string
  }
  counts?: Record<string, Record<string, number>>
  last_scan_at?: string
  current_ocr?: { path: string; page: number; total: number } | null
}

export function getBackgroundWorkStatus() {
  return requestJson<{ background_work: BackgroundWorkStatus }>("/background-work/status")
}

export interface BackgroundWorkQueueEvaluatingItem {
  path: string
  file_name: string
  state: "pending" | "evaluating" | string
  source?: string
  is_presentation?: boolean
}

export interface BackgroundWorkQueueOcrItem {
  path: string
  file_name: string
  state: "pending" | "running" | string
  reason?: string
  attempts?: number
}

export interface BackgroundWorkQueueEmbeddingItem {
  path: string
  file_name: string
  state: "pending" | "running" | string
  attempts?: number
}

export interface BackgroundWorkQueueFailedItem {
  path: string
  file_name: string
  state: "failed" | "blocked" | string
  error?: string
  attempts?: number
  next_retry_at?: number
}

export interface BackgroundWorkQueueDetails {
  current_ocr?: { path: string; file_name?: string; page: number; total: number } | null
  evaluating: BackgroundWorkQueueEvaluatingItem[]
  ocr_pending: BackgroundWorkQueueOcrItem[]
  ocr_failed?: BackgroundWorkQueueFailedItem[]
  embedding_pending: BackgroundWorkQueueEmbeddingItem[]
  spacing_pending?: Array<{ path: string; file_name: string; state: string; error?: string; attempts?: number; next_retry_at?: number; progress?: { page: number; total: number } | null }>
  total_waiting: number
}

export function getBackgroundWorkQueue() {
  return requestJson<{ queue: BackgroundWorkQueueDetails }>("/background-work/queue")
}

export function submitGrammarRefinementPassword(path: string, password: string) {
  return requestJson<{ accepted: boolean }>("/background-work/spacing/password", {
    method: "POST",
    body: JSON.stringify({ path, password }),
  })
}
