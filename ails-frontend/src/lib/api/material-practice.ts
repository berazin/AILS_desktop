import { requestJson } from "./core.ts"
import type { PracticeSolveRound, PracticeRetryMode } from "./practice-rounds.ts"

export interface MaterialPracticeAttempt {
  id: string
  question_version: string
  question_revision: number
  selected_option_id?: string
  answer_option_id?: string
  answer_text?: string
  feedback?: string
  provider?: string
  model?: string
  correct: boolean
  explanation: string
  elapsed_seconds: number
  graded_at: string
}

export interface MaterialPracticeAttemptSummary {
  id: string
  elapsed_seconds: number
  graded_at: string
}

export interface MaterialPracticeQuestion {
  last_solve_correct?: boolean | null
  solve_round_id?: string
  solve_round_number?: number
  solve_history_count?: number
  id: string
  ordinal: number
  question: string
  options: Array<{ id: string; text: string }>
  source_file: string
  question_version: string
  question_revision: number
  selected_option_id: string
  answer_type: "multiple_choice" | "short_answer"
  answer_text: string
  reference_answer?: string
  elapsed_seconds: number
  timer_running: boolean
  attempts: Array<MaterialPracticeAttempt | MaterialPracticeAttemptSummary>
  current_result: MaterialPracticeAttempt | null
  ai_hint: { text: string; provider: string; model: string } | null
  answer_option_id?: string
  explanation?: string
}

export interface MaterialPracticeSet {
  last_question_id?: string
  set_id: string
  valid: boolean
  errors: string[]
  question_count: number
  completed_count: number
  questions: MaterialPracticeQuestion[]
}

export interface MaterialPracticeMutation {
  path: string
  set_id: string
  question_id: string
  question_version: string
  question_revision: number
}

export function loadMaterialPracticeSet(path: string, signal?: AbortSignal) {
  return requestJson<{ set: MaterialPracticeSet }>(`/material-practice/set?path=${encodeURIComponent(path)}`, { signal })
}

export function saveMaterialPracticeAnswer(payload: MaterialPracticeMutation & { selected_option_id?: string; answer_text?: string }, signal?: AbortSignal) {
  return requestJson<{ question: MaterialPracticeQuestion }>("/material-practice/answer", {
    method: "POST", body: JSON.stringify(payload), signal,
  })
}

export function updateMaterialPracticeTimer(payload: MaterialPracticeMutation & { action: "start" | "pause" }, signal?: AbortSignal) {
  return requestJson<{ question: MaterialPracticeQuestion }>("/material-practice/timer", {
    method: "POST", body: JSON.stringify(payload), signal,
  })
}

export function gradeMaterialPracticeAnswer(payload: MaterialPracticeMutation & { attempt_id: string; selected_option_id?: string; answer_text?: string }, signal?: AbortSignal) {
  return requestJson<{
    question: MaterialPracticeQuestion
    grading: MaterialPracticeAttempt
    duplicate: boolean
    stale: boolean
  }>("/material-practice/grade", { method: "POST", body: JSON.stringify(payload), signal })
}

export function retryMaterialPracticeQuestion(payload: MaterialPracticeMutation, signal?: AbortSignal) {
  return requestJson<{ question: MaterialPracticeQuestion }>("/material-practice/retry", {
    method: "POST", body: JSON.stringify(payload), signal,
  })
}

export function retryMaterialPracticeBatch(payload: { path: string; set_id: string; mode: PracticeRetryMode; items: Array<Omit<MaterialPracticeMutation, "path" | "set_id">> }) {
  return requestJson<{ set: MaterialPracticeSet; target_ids: string[]; changed_count: number }>("/material-practice/retry-batch", { method: "POST", body: JSON.stringify(payload) })
}

export function loadMaterialPracticeHistory(payload: MaterialPracticeMutation) {
  return requestJson<{ rounds: PracticeSolveRound[] }>("/material-practice/history", { method: "POST", body: JSON.stringify(payload) })
}

export function selectMaterialPracticeQuestion(payload: MaterialPracticeMutation) {
  return requestJson<{ question: MaterialPracticeQuestion }>("/material-practice/select", { method: "POST", body: JSON.stringify(payload) })
}

export function generateMaterialPracticeHint(payload: MaterialPracticeMutation & { force?: boolean }, signal?: AbortSignal) {
  return requestJson<{
    hint: string
    provider: string
    model: string
    cached: boolean
    question?: MaterialPracticeQuestion
    usage?: unknown
  }>("/material-practice/hint/generate", {
    method: "POST", body: JSON.stringify(payload), signal,
  })
}
