import { requestJson, type ModelSettings } from "./core.ts"
import type { AiProviderSettings } from "./chatgpt.ts"

// ── Managed AI Policy ─────────────────────────────────────────────────────────

export interface ManagedAiModelEntry {
  id: string
  canonical_id?: string
  name: string
  provider: string
  input_rate_usd_per_1m?: number
  output_rate_usd_per_1m?: number
  context_k?: number
  tags?: string[]
  capabilities?: string[]
}

export interface ManagedAiPolicyResponse {
  routing_platform: 'vercel' | 'openrouter'
  provider_status?: 'available' | 'on_hold'
  models: ManagedAiModelEntry[]
  review_models?: string[]
  ails_default_model?: string
  workflow_defaults: Record<string, string>
  server_defaults?: Record<string, string>
  workflows?: Array<Record<string, unknown>>
}

export interface ModelSelectionPreviewRoute {
  mode: "managed" | "local" | "chatgpt" | "error"
  billing_mode?: "chatgpt"
  model_id?: string
  model_name?: string
  provider?: string
  source: "workflow" | "common" | "ails"
  fallback_reason?: string | null
  error?: string
}

export interface ModelSelectionPreviewResponse {
  workflows: Record<string, ModelSelectionPreviewRoute>
  chatgpt_models?: { id: string; name: string }[]
  chatgpt_error?: string
}

export function getManagedAiPolicy() {
  return requestJson<ManagedAiPolicyResponse>('/managed-ai-policy', { method: 'GET' })
}

export function previewAiModelSelections(settings: ModelSettings, workflowDefaults: Record<string, string>, providerSettings?: AiProviderSettings) {
  return requestJson<ModelSelectionPreviewResponse>('/model-selection/preview', {
    method: 'POST',
    body: JSON.stringify({ settings, workflow_defaults: workflowDefaults, provider_settings: providerSettings }),
  })
}
