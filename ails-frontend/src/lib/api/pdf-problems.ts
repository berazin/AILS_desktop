import { requestJson, requestNdjsonStream } from "./core.ts"
import type { AILSConfig } from "./core.ts"
import type { PracticeSolveRound, PracticeRetryMode } from "./practice-rounds.ts"

export type PdfProblemKind = 'practice' | 'lab' | 'quiz'
export type PdfProblemStatus = 'not_started' | 'in_progress' | 'completed' | 'retry'
export type PdfProblemAnswerType = 'multiple_choice' | 'short_answer' | 'ox' | 'code' | 'unknown'

export interface PdfProblemAnswerTypePrediction {
  value: PdfProblemAnswerType
  confidence: number
  reason?: string
  classifier_version?: string
}

export interface PdfProblemDraftAnswer {
  answer_text?: string
  selected_choice?: number | null
  updated_at?: string
}

export interface PdfProblemLabelBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface PdfTheoryReference {
  page: number
  title: string
  concept?: string
  snippet?: string
  score?: number
  semantic_score?: number
  keyword_score?: number
  title_score?: number
  page_bonus?: number
  chapter_priority?: number
  matched_keywords?: string[]
}

export interface PdfMistakeNote {
  id: string
  source: 'grading' | 'run' | 'test' | 'compile'
  created_at: string
  retry_due_at: string
  failure_reason: string
  remediation: string
  core_concepts: string[]
  search_keywords: string[]
  related_theory: PdfTheoryReference[]
}

export interface PdfProblemGradingSummary {
  correct: boolean | null
  verdict: 'correct' | 'incorrect' | 'unresolved'
  feedback: string
  reasoning_summary?: string
  suggestions?: string[]
  core_concepts?: string[]
  search_keywords?: string[]
  failure_reason?: string
  remediation?: string
  related_theory?: PdfTheoryReference[]
  submitted_at?: string
  provider?: string
  model?: string
  submission_hash?: string
  evidence?: { source: { path: string; version: string }; mapping_revision: string; rubric_origin: string }
}

export interface PdfProblemHint {
  text: string
  provider?: string
  model?: string
  generated_at?: string | null
}

export interface PdfProblem {
  last_solve_correct?: boolean | null
  solve_round_id?: string
  solve_round_number?: number
  solve_history_count?: number
  id: string
  number: number
  kind: PdfProblemKind
  folder_name: string
  folder_path?: string | null
  chapter: string
  chapter_folder?: string
  page: number
  page_end: number
  label_bbox?: PdfProblemLabelBox | null
  status: PdfProblemStatus
  grading_revision?: number
  updated_at?: string | null
  elapsed_seconds: number
  last_attempt_at?: string | null
  wrong_count: number
  ai_hint_used: boolean
  ai_hint?: PdfProblemHint | null
  timer_started_at?: string | null
  is_code_problem?: boolean
  answer_type?: PdfProblemAnswerType
  answer_type_prediction?: PdfProblemAnswerTypePrediction | null
  answer_type_override?: PdfProblemAnswerType | null
  choices?: string[]
  code?: string[]
  code_positions?: number[]
  paddleocr_original?: {
    problem_text: string
    number: number
    page: number
    page_end: number
    choices: string[]
    code: string[]
    code_positions: number[]
    answer_type: PdfProblemAnswerType
  }
  practice_content_source?: 'paddleocr' | 'ai_review' | 'user_edit' | 'user_review'
  draft_answer?: PdfProblemDraftAnswer | null
  classification_reason?: string
  status_label?: string
  problem_text?: string
  core_concepts?: string[]
  search_keywords?: string[]
  related_theory?: PdfTheoryReference[]
  mistake_notes?: PdfMistakeNote[]
  retry_due_at?: string | null
  last_grading?: PdfProblemGradingSummary | null
  current_answer_hash?: string | null
  answer_key?: { status: "unlinked" | "confirmed" | "stale"; kind?: string; source_name?: string; source_version?: string; reason?: string; reason_code?: string; connection_method?: "user" | "automatic" }
}

export interface PdfProblemsPayload {
  pdf_path: string
  problems: PdfProblem[]
  scanned?: boolean
  stale?: boolean
  analysis_source?: 'saved' | 'new' | 'stale' | 'missing'
  analyzed_at?: string | null
  answer_key_auto?: { status: 'ready' | 'partial' | 'not_found' | 'unreadable' | 'skipped'; reason?: string; newly_connected: number; automatic_count: number; review_count: number; cached: boolean }
}

export interface PdfProblemMutationPayload {
  solve_round_id?: string
  pdf_path: string
  base_dir: string
  problem_id: string
}

export interface PdfProblemGradeResult extends PdfProblemGradingSummary {
  problem: PdfProblem
  attempt_id: string
  revision: number
  application_status: 'applied' | 'stale' | 'duplicate' | 'unresolved'
  applied: boolean
  related_theory?: PdfTheoryReference[]
  theory_search?: {
    weights?: Record<string, number>
    chapter?: string
    embedding_backend?: string
    degraded?: boolean
  }
  theory_search_warning?: string
}

export interface PdfProblemHintResult {
  problem: PdfProblem
  hint: string
  provider?: string
  model?: string
  cached: boolean
  usage?: Record<string, unknown>
}

export interface PdfProblemReviewProposal {
  problem_text: string
  number: number
  page: number
  page_end: number
  answer_type: PdfProblemAnswerType
  choices: string[]
  code: string[]
  code_positions?: number[]
  reason: string
  confidence: number
  changed: boolean
  separation_actions?: string[]
  auto_apply_eligible?: boolean
}

export interface PdfProblemReviewResult {
  problem: PdfProblem
  proposal: PdfProblemReviewProposal
  provider?: string
  model?: string
  usage?: Record<string, unknown>
}

export interface PdfProblemMultimodalReview {
  model: string
  proposal: PdfProblemReviewProposal | null
  raw_proposal?: Partial<PdfProblemReviewProposal> & Record<string, unknown>
  validation_error?: string
  original: PdfProblem
  crop_sha256?: string
  page_image_sha256?: string[]
  batch_pages?: number[]
  batch_id?: string
  latency_ms: number
  usage?: Record<string, unknown>
  application_status: 'proposed' | 'applied' | 'failed' | 'needs_user_review' | 'superseded' | 'not_selected' | 'user_selected' | 'user_not_selected'
  applied: boolean
  applied_at?: number
}

export interface PdfProblemReviewQueueItem {
  problem_id: string
  page: number
  number: number
  original: PdfProblem
  reason: string
  confidence_threshold: number
  primary_review: PdfProblemMultimodalReview
  fallback_review: PdfProblemMultimodalReview
  review_provenance?: {
    luna: { stage: 'secondary'; model: string }
    gemini: { stage: 'fallback'; model: string }
  }
  queued_at: number
  status: 'needs_user_review' | 'resolved'
  selected_source?: PdfProblemReviewSelectionSource
  resolved_at?: number
  final_content?: PdfProblemReviewResolutionContent
  resolution_history?: PdfProblemReviewResolution[]
  last_resolution?: PdfProblemReviewResolution
}

export type PdfProblemReviewSelectionSource = 'paddleocr' | 'local' | 'luna' | 'gemini'

export interface PdfProblemReviewResolutionContent {
  problem_text: string
  choices: string[]
  code: string[]
  code_positions?: number[]
  answer_type: PdfProblemAnswerType
}

export interface PdfProblemReviewResolution {
  resolution_id: string
  status: 'requested' | 'applied' | 'failed'
  selected_source: PdfProblemReviewSelectionSource
  selected_model?: string
  review_stage?: 'paddleocr' | 'secondary' | 'fallback'
  final_content: PdfProblemReviewResolutionContent
  recorded_at?: number
  editor_action?: string
  error?: string
}

export interface PdfProblemReviewGoldSample {
  problem_id: string
  saved_at: number
  human_confirmed: true
  truth: PdfProblemReviewProposal & { kind?: PdfProblemKind }
}

export function scanPdfProblems(
  payload: { pdf_path: string; base_dir: string; force?: boolean },
  signal?: AbortSignal,
) {
  return requestJson<PdfProblemsPayload>('/pdf/problems/scan', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function getPdfProblems(pdfPath: string, baseDir: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ pdf_path: pdfPath, base_dir: baseDir })
  return requestJson<PdfProblemsPayload>(`/pdf/problems?${params.toString()}`, { signal })
}

export function updatePdfProblemState(
  payload: PdfProblemMutationPayload & { status: PdfProblemStatus },
  signal?: AbortSignal,
) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/state', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function startPdfProblemTimer(payload: PdfProblemMutationPayload, signal?: AbortSignal) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/timer/start', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function retryPdfProblem(payload: PdfProblemMutationPayload & { draft_files?: Array<{ name: string; code: string }> }) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/retry', { method: 'POST', body: JSON.stringify(payload) })
}

export function retryPdfProblemsBatch(payload: { pdf_path: string; base_dir: string; mode: PracticeRetryMode;
  items: Array<{ problem_id: string; solve_round_id?: string; draft_files?: Array<{ name: string; code: string }> }> }) {
  return requestJson<{ problems: PdfProblem[]; target_ids: string[]; changed_count: number }>('/pdf/problems/retry-batch', { method: 'POST', body: JSON.stringify(payload) })
}

export function savePdfProblemCodeDraft(payload: PdfProblemMutationPayload & { draft_files: Array<{ name: string; code: string }> }) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/code-draft', { method: 'POST', body: JSON.stringify(payload) })
}

export function loadPdfProblemHistory(payload: PdfProblemMutationPayload) {
  return requestJson<{ rounds: PracticeSolveRound[] }>('/pdf/problems/history', { method: 'POST', body: JSON.stringify(payload) })
}

export function stopPdfProblemTimer(payload: PdfProblemMutationPayload, signal?: AbortSignal) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/timer/stop', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function recordPdfProblemHint(payload: PdfProblemMutationPayload, signal?: AbortSignal) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/hint', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function generatePdfProblemHint(
  payload: PdfProblemMutationPayload & {
    answer_text?: string
    selected_choice?: number | null
    force?: boolean
  },
  signal?: AbortSignal,
) {
  return requestJson<PdfProblemHintResult>('/pdf/problems/hint/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function updatePdfProblemAnswerType(
  payload: PdfProblemMutationPayload & { answer_type: PdfProblemAnswerType },
  signal?: AbortSignal,
) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/type', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function updatePdfProblem(
  payload: PdfProblemMutationPayload & {
    problem_text: string
    number: number
    page: number
    page_end: number
    answer_type: PdfProblemAnswerType
    choices: string[]
    code?: string[]
    code_positions?: number[]
    edit_source?: 'user' | 'ai'
  },
  signal?: AbortSignal,
) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/edit', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function reviewPdfProblem(payload: PdfProblemMutationPayload, signal?: AbortSignal) {
  return requestJson<PdfProblemReviewResult>('/pdf/problems/review', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

/** Page-batched AI gateway image review. Validated results are applied automatically. */
export function reviewPdfProblemMultimodal(
  payload: PdfProblemMutationPayload & { model?: string }, signal?: AbortSignal,
) {
  return requestJson<{
    problem: PdfProblem
    problems: PdfProblem[]
    review: PdfProblemMultimodalReview
    reviews: PdfProblemMultimodalReview[]
    review_queue: PdfProblemReviewQueueItem[]
    pending_review_queue: PdfProblemReviewQueueItem[]
    page_problem_count: number
    applied_problem_count: number
    queued_problem_count: number
    application_errors: Array<{ problem_id: string; error: string }>
    primary_model: string
    fallback_model: string
    fallback_requested: boolean
    fallback_problem_ids: string[]
    confidence_threshold: number
    usage: {
      primary_cost_usd: number
      fallback_cost_usd: number
      total_cost_usd: number
      call_count: number
    }
  }>('/pdf/problems/multimodal-review', {
    method: 'POST', body: JSON.stringify(payload), signal,
  })
}

export type PdfProblemAutoReviewStatusName =
  | 'idle'
  | 'queued'
  | 'running'
  | 'cancel_pending'
  | 'completed'
  | 'completed_with_errors'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'stale'
  | 'budget_exhausted'
  | 'budget_accounting_error'

export interface PdfProblemAutoReviewStatus {
  job_id?: string
  status: PdfProblemAutoReviewStatusName
  mode?: "benchmark" | "production"
  review_engine?: "local" | "cloud"
  run_scope?: "all" | "review_queue"
  budget_unlimited?: boolean
  pdf_path: string
  base_dir: string
  catalog_revision?: string
  page_total: number
  page_processed: number
  problem_total: number
  problem_processed?: number
  applied_problem_count?: number
  queued_problem_count?: number
  application_error_count?: number
  failed_page_count?: number
  current_page?: number | null
  spent_usd: number
  budget_usd: number | null
  reserved_next_call_usd?: number
  primary_model?: string
  fallback_model?: string
  confidence_threshold?: number
  cancel_requested?: boolean
  deduplicated?: boolean
  retry_count?: number
  retry_available?: boolean
  retry_of_job_id?: string
  parallel_workers?: number
  errors?: Array<{ page?: number; problem_id?: string; error: string }>
}

export function startPdfProblemAutoReview(
  payload: {
    pdf_path: string;
    base_dir: string;
    mode?: "benchmark" | "production";
    review_engine?: "local" | "cloud";
    local_problem_review_model?: AILSConfig['local_problem_review_model'];
    retry_failed?: boolean;
    review_queue_only?: boolean;
    page?: number;
    work_acknowledged?: boolean;
  },
  signal?: AbortSignal,
) {
  return requestJson<PdfProblemAutoReviewStatus>('/pdf/problems/multimodal-review/auto/start', {
    method: 'POST', body: JSON.stringify(payload), signal,
  })
}

export function getPdfProblemAutoReviewStatus(pdfPath: string, baseDir: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ pdf_path: pdfPath, base_dir: baseDir })
  return requestJson<PdfProblemAutoReviewStatus>(
    `/pdf/problems/multimodal-review/auto/status?${params.toString()}`,
    { signal },
  )
}

export function cancelPdfProblemAutoReview(
  payload: { pdf_path: string; base_dir: string },
  signal?: AbortSignal,
) {
  return requestJson<PdfProblemAutoReviewStatus & { cancelled: boolean }>(
    '/pdf/problems/multimodal-review/auto/cancel',
    { method: 'POST', body: JSON.stringify(payload), signal },
  )
}

export function getPdfProblemMultimodalReviewQueue(
  pdfPath: string,
  baseDir: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ pdf_path: pdfPath, base_dir: baseDir })
  return requestJson<{ items: PdfProblemReviewQueueItem[]; count: number; unresolved_count: number }>(
    `/pdf/problems/multimodal-review/queue?${params.toString()}`,
    { signal },
  )
}

export function resolvePdfProblemMultimodalReviewQueueItem(
  payload: PdfProblemMutationPayload & {
    selected_source: PdfProblemReviewSelectionSource
    final_content: PdfProblemReviewResolutionContent
  },
  signal?: AbortSignal,
) {
  return requestJson<{ problem: PdfProblem; item: PdfProblemReviewQueueItem }>(
    '/pdf/problems/multimodal-review/queue/resolve',
    { method: 'POST', body: JSON.stringify(payload), signal },
  )
}

export function getPdfProblemMultimodalGoldSamples(pdfPath: string, baseDir: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ pdf_path: pdfPath, base_dir: baseDir })
  return requestJson<{ samples: PdfProblemReviewGoldSample[]; count: number; target_count: number }>(
    `/pdf/problems/multimodal-review/gold?${params.toString()}`,
    { signal },
  )
}

export function savePdfProblemMultimodalGoldSample(
  payload: PdfProblemMutationPayload & { human_confirmed: true },
  signal?: AbortSignal,
) {
  return requestJson<{ sample: PdfProblemReviewGoldSample; count: number; target_count: number }>(
    '/pdf/problems/multimodal-review/gold',
    { method: 'POST', body: JSON.stringify(payload), signal },
  )
}

export function choosePdfProblemReviewModel(
  results: Array<{ model: string; exact_match: number; critical_errors?: number; cost_usd?: number }>,
  budget_usd = 2,
  signal?: AbortSignal,
) {
  return requestJson<{ selected_model: string; total_cost_usd: number; budget_usd: number; sample_count: number }>('/pdf/problems/multimodal-review/choose-model', {
    method: 'POST', body: JSON.stringify({ results, budget_usd }), signal,
  })
}

export function savePdfProblemAnswer(
  payload: PdfProblemMutationPayload & {
    answer_text?: string
    selected_choice?: number | null
  },
  signal?: AbortSignal,
) {
  return requestJson<{ problem: PdfProblem }>('/pdf/problems/answer', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export type PdfProblemGradePayload = PdfProblemMutationPayload & {
    attempt_id: string
    answer_type?: PdfProblemAnswerType
    answer_text?: string
    selected_choice?: number | null
    project_name?: string
    active_file_name?: string
    language?: string
    files?: Array<{ name: string; code: string }>
    run_result?: {
      success: boolean | null
      returncode?: number | null
      stdout: string
      stderr: string
      action?: 'run' | 'build' | 'test'
    }
  }

export function gradePdfProblem(
  payload: PdfProblemGradePayload,
  signal?: AbortSignal,
) {
  return requestJson<PdfProblemGradeResult>('/pdf/problems/grade', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export interface PdfProblemBatchGradeResponse {
  results: Array<{ problem_id: string; result?: PdfProblemGradeResult; error?: string }>
  cancelled: boolean
  usage?: Record<string, unknown> | null
  provider?: string
  model?: string
  error?: string | null
}

export type PdfProblemBatchGradeItem = PdfProblemBatchGradeResponse['results'][number]
type PdfProblemBatchGradeEvent =
  | { type: 'started'; total: number }
  | ({ type: 'result' } & PdfProblemBatchGradeItem)
  | { type: 'done'; result: PdfProblemBatchGradeResponse }

export async function gradePdfProblemsBatch(payload: {
  pdf_path: string
  base_dir: string
  items: Array<Omit<PdfProblemGradePayload, 'pdf_path' | 'base_dir'>>
}, signal?: AbortSignal, onResult?: (item: PdfProblemBatchGradeItem) => void) {
  if (onResult) {
    let completed: PdfProblemBatchGradeResponse | null = null
    await requestNdjsonStream<PdfProblemBatchGradeEvent | PdfProblemBatchGradeResponse>('/pdf/problems/grade-batch', {
      method: 'POST', body: JSON.stringify({ ...payload, stream: true }), signal,
      onEvent: event => {
        if ('type' in event) {
          if (event.type === 'result') onResult(event)
          else if (event.type === 'done') completed = event.result
        } else if ('results' in event) {
          // An already-running older backend can still finish its JSON request
          // while the source backend is being updated to the stream transport.
          completed = event
          for (const item of event.results) onResult(item)
        }
      },
    })
    if (!completed) throw new Error('Batch grading stream ended before completion.')
    return completed as PdfProblemBatchGradeResponse
  }
  return requestJson<PdfProblemBatchGradeResponse>('/pdf/problems/grade-batch', {
    method: 'POST', body: JSON.stringify(payload), signal,
  })
}

export interface PdfAnswerKeyCandidate {
  id: string
  chapter: string
  number: number
  subquestion: string
  answer: string
  criteria: string
  question: string
  kind: 'choice' | 'short' | 'numeric' | 'essay' | 'ox'
  original_text: string
  confidence: number
  method: string
  location: { page: number; line_start: number; line_end: number; bbox: PdfProblemLabelBox | null }
  occurrences?: Array<{ id: string; original_text: string; location: PdfAnswerKeyCandidate['location']; method: string; confidence: number }>
}
export interface PdfAnswerKeyRegion {
  page_start: number; page_end: number; line_start?: number; line_end?: number; bbox?: PdfProblemLabelBox | null
  page_boxes?: Record<string, PdfProblemLabelBox>
}
export interface PdfAnswerKeyPreview {
  preview_id: string
  status: 'ready' | 'unreadable' | 'unsupported'
  reason: string
  cached: boolean
  source: { path: string; version: string; edition: string; region?: PdfAnswerKeyRegion; auto_detected?: boolean }
  discovery?: { status: 'detected' | 'not_found'; reason: string; page_count?: number; region?: PdfAnswerKeyRegion } | null
  candidates: PdfAnswerKeyCandidate[]
  rows: Array<{ problem_id: string; problem_version: string; problem: Pick<PdfProblem, 'chapter' | 'number' | 'problem_text' | 'page' | 'page_end'>; candidate_ids: string[]; risks: string[]; batch?: { candidate_id: string; ready: boolean; reason: string } }>
  links: Record<string, { status: string; candidate_id: string }>
}
export function previewPdfAnswerKey(payload: {
  pdf_path: string; base_dir: string; source_path: string; edition: string; hide_answers: boolean
  auto_detect?: boolean
  region?: PdfAnswerKeyRegion
}, signal?: AbortSignal) {
  return requestJson<PdfAnswerKeyPreview>('/pdf/problems/answer-key/preview', { method: 'POST', body: JSON.stringify(payload), signal })
}
export function confirmPdfAnswerKey(payload: PdfProblemMutationPayload & {
  preview_id?: string; candidate_id?: string; problem_version?: string; verified?: boolean; edition_verified?: boolean
  verification_note?: string; kind?: PdfAnswerKeyCandidate['kind']; answer?: string; criteria?: string
  accepted_answers?: string[]; absolute_tolerance?: string; unlink?: boolean
}) {
  return requestJson<{ problem: PdfProblem; status: string }>('/pdf/problems/answer-key/confirm', { method: 'POST', body: JSON.stringify(payload) })
}
export function managePdfAnswerKey(payload: PdfProblemMutationPayload) {
  return requestJson<{ source?: (PdfAnswerKeyPreview['source'] & { region: { page_start: number; page_end: number; line_start: number; line_end: number; bbox: PdfProblemLabelBox | null } }) | null; link: null | {
    status: string; source: PdfAnswerKeyPreview['source'] & { region: { page_start: number; page_end: number; line_start: number; line_end: number; bbox: PdfProblemLabelBox | null } }
    candidate_id: string; verification_note: string; policy: { kind: PdfAnswerKeyCandidate['kind']; answer: string; criteria: string; accepted_answers?: string[]; absolute_tolerance?: string }
  } }>('/pdf/problems/answer-key/manage', { method: 'POST', body: JSON.stringify(payload) })
}

export interface PdfAnswerKeyBatchItem {
  problem_id: string
  problem_version: string
  candidate_id: string
  kind?: PdfAnswerKeyCandidate['kind']
  answer?: string
  criteria?: string
  accepted_answers?: string[]
  absolute_tolerance?: string
}
export function confirmPdfAnswerKeys(payload: {
  pdf_path: string; base_dir: string; preview_id: string; items: PdfAnswerKeyBatchItem[]
  verified: boolean; edition_verified: boolean; verification_note: string
}) {
  return requestJson<{ status: 'confirmed'; count: number; problems: PdfProblem[] }>('/pdf/problems/answer-key/confirm-batch', { method: 'POST', body: JSON.stringify(payload) })
}
