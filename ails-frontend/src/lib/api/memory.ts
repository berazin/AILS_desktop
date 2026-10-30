import { requestJson } from "./core.ts"

export interface UserMemoryItem {
  id: string
  kind: "profile" | "learning" | "episodic" | "goal"
  subject: string
  content: string
  keywords: string[]
  importance: number
  status: "active" | "compressed" | "merged" | "archived"
  source: "chat" | "grading" | "manual" | "summary"
  summary_of: string[]
  access_count: number
  last_accessed_at: string
  created_at: string
  updated_at: string
}

export interface UserMemoryMastery {
  subject: string
  concept: string
  mastery: number
  confidence: number
  mistake_count: number
  correct_count: number
  last_reviewed_at: string
}

export interface UserMemorySnapshot {
  items: UserMemoryItem[]
  mastery: UserMemoryMastery[]
  settings: Record<string, string | number | boolean>
  storage: { backend: string; path: string; embedding_backend: string; degraded: boolean }
  kinds: UserMemoryItem["kind"][]
  enabled: boolean
  context_budgets: Record<string, number>
  model_context_limit_tokens: number
}

export function getUserMemory() {
  return requestJson<UserMemorySnapshot>("/memory")
}

export function saveUserMemoryItem(payload: {
  action?: "create" | "update" | "compress"
  id?: string
  kind?: UserMemoryItem["kind"]
  subject?: string
  content?: string
  importance?: number
}) {
  return requestJson<{ item?: UserMemoryItem; action?: string; compressed?: UserMemoryItem | null }>("/memory", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function deleteUserMemoryItem(id: string) {
  return requestJson<{ deleted: boolean; id: string }>("/memory/delete", {
    method: "POST",
    body: JSON.stringify({ id }),
  })
}

export function saveUserMemorySettings(payload: {
  memory_enabled?: boolean
  memory_settings?: Record<string, number | boolean>
  context_budgets?: Record<string, number>
  model_context_limit_tokens?: number
}) {
  return requestJson<{
    memory_enabled: boolean
    memory_settings: Record<string, string | number | boolean>
    context_budgets: Record<string, number>
    model_context_limit_tokens: number
  }>("/memory/settings", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}
