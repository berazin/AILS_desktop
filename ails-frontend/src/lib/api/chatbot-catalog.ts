import { requestJson } from "./core.ts"

export interface ManagedChatbotModel {
  id: string; name: string; developer: string; aliases: string[]
  input_modalities: string[]; output_modalities: string[]; supported_parameters: string[]
  context_length: number | null; max_output_tokens: number | null
  tools: boolean | null; streaming: boolean | null; vision: boolean | null
  input_price: number | null; output_price: number | null; estimated_request_cost: number | null
  available: boolean; experimental: boolean; privacy: "enforced" | "unverified"
  recommended: boolean; recommendation_basis: "verified" | "metadata" | null
  verification_needed: string[]
  reasoning: { values: string[]; default_effort: string | null; mandatory: boolean | null; supports_budget: boolean }
  evaluation: { latency_ms?: number; korean?: boolean; learning?: boolean } | null
}
export interface ManagedChatbotCatalog {
  platform: "vercel" | "openrouter"; models: ManagedChatbotModel[]
  default_model_id: string | null; fetched_at: string; expires_at: string; stale: boolean
  estimate_tokens: { input: number; output: number }
}
let cached: { value: ManagedChatbotCatalog; until: number } | null = null
let pending: Promise<ManagedChatbotCatalog> | null = null
export function getManagedChatbotCatalog(force = false): Promise<ManagedChatbotCatalog> {
  if (!force && cached && cached.until > Date.now()) return Promise.resolve(cached.value)
  if (pending) return pending
  pending = requestJson<ManagedChatbotCatalog>("/chatbot/model-catalog").then(value => {
    cached = { value, until: Math.min(Date.now() + 60_000, Date.parse(value.expires_at)) }
    return value
  }).finally(() => { pending = null })
  return pending
}

export function validateManagedChatbotModel(modelId: string, requireTools = false) {
  return requestJson<{ valid: boolean; model_id: string }>("/chatbot/model-selection/validate", {
    method: "POST", body: JSON.stringify({ model_id: modelId, require_tools: requireTools }),
  })
}
