import { requestJson } from "./core.ts"
import type { LocalAiModelStatus } from "./core.ts"

export type WorkPreflightOperation =
  | 'pdf_ocr'
  | 'pdf_translation'
  | 'pdf_problem_review'
  | 'voice_agent'
  | 'video_detailed'
  | 'video_summary'

export interface WorkPreflight {
  operation: WorkPreflightOperation
  execution: 'local' | 'external_ai' | 'hybrid'
  steps: Array<{
    kind: 'local' | 'external_ai'
    label: string
    estimated_seconds: number
    estimated_cost_usd: number | null
    conditional: boolean
  }>
  estimated_seconds: number
  estimated_cost_usd: number | null
  estimate_basis: string
  credit: {
    enforced: boolean
    available_usd: number | null
    required_usd: number | null
    sufficient: boolean | null
    reason: string
  }
  allowed: boolean
  route_type?: 'personal' | 'managed' | 'local' | 'chatgpt' | 'mixed'
  route_label?: string
  local_stt_model?: null | (LocalAiModelStatus & {
    selected_model: string
    bundled: boolean
  })
  local_voice_agent_model?: null | LocalAiModelStatus
  local_problem_review_model?: null | LocalAiModelStatus
}

export function getWorkPreflight(
  payload: Record<string, unknown> & { operation: WorkPreflightOperation },
  signal?: AbortSignal,
) {
  return requestJson<WorkPreflight>('/work/preflight', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}
