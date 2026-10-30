import { requestJson } from "../../lib/api/core.ts"

export type ClaimFeedback = {
  correction?: string; reason?: string; concept?: string; uncertainty?: string; check?: string; extension?: string
}
export type ReviewFilter = "pending" | "completed"
export type Claim = {
  id: string; text: string; verdict: "VERIFIED" | "PARTIALLY_CORRECT" | "INCORRECT" | "UNCERTAIN"
  basis: "source" | "model"; evidence_ids: string[]; intuition: string; explanation: string
  corrected: string; extension: string; misconception: string
  summary?: string; feedback?: ClaimFeedback
}
export type Evidence = { id: string; path: string; page: number; section: string; text: string }
export type Gate = {
  verdict: "VERIFIED" | "PARTIALLY_CORRECT" | "INCORRECT" | "UNCERTAIN"
  claims: Claim[]; knowledge: string; improved_insight: string; evidence: Evidence[]
}
export type RawInsight = { id: string; run_id: string; text: string; sources: string[]; parent_id: string; created_at: number; review_status?: "pending" | "completed" | "revised" }
export type InsightTiming = {
  total_s: number; auth_check_s: number; auth_check_count: number; auth_remote_s: number; auth_remote_count: number
  provider_auth_s?: number; session_setup_s?: number
  ai_response_s?: number; ai_non_auth_s?: number; ai_headers_s?: number; ai_first_event_s?: number; ai_first_output_s?: number
}
export type InsightRun = {
  id: string; kind: string; state: string; phase: string; error: string; attempt: number
  gate?: Gate; payload: { raw_id?: string; wrong_id?: string }; outcome?: string
  accepted_correction?: { source_raw_id: string; source_run_id: string; accepted_at: number }
  published_revision?: number; created_at: number; cancel_requested?: boolean
  submission_timing?: InsightTiming
  call_timings?: (InsightTiming & { call_id: string; operation: string; state: string; started_at?: number; received_at?: number
    model?: string; requested_reasoning_effort?: string; reported_reasoning_effort?: string; thought_tokens?: number })[]
  phase_timings?: { phase: string; started_at: number; ended_at: number; elapsed_s: number }[]
}
export type BookSection = {
  id: string; chapter: string; title: string; position: number; content: string; revision: number
  provenance: { raw_id: string; claim_ids: string[]; evidence_ids: string[] }[]
}
export type WrongInsight = {
  id: string; raw_id: string; claim: Claim; evidence: Evidence[]; status: "learning" | "mastered"
  next_review: number; review_ids: string[]; mastery: { successes: number; forms: string[] }
}
export type InsightReview = {
  id: string; wrong_id: string; question: string; form: string; created_at: number; graded_at?: number
  answer?: string; expected?: string; grading?: { understood: boolean; feedback: string }
}
export type MaintainerSettings = {
  maintainer_enabled: boolean; maintainer_every: number; section_max_chars: number; maintenance_scope: number
}
export type BookRevision = {
  id: string; revision: number; kind: string; reason: string; created_at: number
  before: BookSection[]; after: BookSection[]; changes: { id: string; action: string; reason: string }[]
}
export type InsightSnapshot = {
  revision: number; sections: BookSection[]; raw_insights: RawInsight[]; runs: InsightRun[]
  wrong_insights: WrongInsight[]; reviews: InsightReview[]; revisions: BookRevision[]
  settings: MaintainerSettings; now: number
  raw_count: number; revision_count: number
  account_scope: string
  review_filter?: ReviewFilter | "all"; review_count?: number; review_counts?: Record<ReviewFilter, number>
}

export function getInsightBook(signal?: AbortSignal, rawOffset = 0, revisionOffset = 0, reviewFilter: ReviewFilter = "pending") {
  return requestJson<InsightSnapshot>(`/insight-book?raw_offset=${rawOffset}&revision_offset=${revisionOffset}&review_filter=${reviewFilter}`, { signal })
}
export function getInsightRecord(rawId: string) {
  return requestJson<{ raw: RawInsight; run: InsightRun }>(`/insight-book/record?raw_id=${encodeURIComponent(rawId)}`)
}
export function submitInsight(payload: { text: string; sources: string[]; request_id: string; parent_id?: string; approve_correction?: boolean }) {
  return requestJson<{ run: InsightRun }>("/insight-book/submit", { method: "POST", body: JSON.stringify(payload) })
}
export function insightAction(payload: Record<string, unknown>) {
  return requestJson<{ run?: InsightRun }>("/insight-book/action", { method: "POST", body: JSON.stringify(payload) })
}
