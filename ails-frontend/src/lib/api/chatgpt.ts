import { requestJson } from "./core.ts"

export type AiProvider = "ails" | "chatgpt"
export interface AiProviderSettings {
  default: AiProvider
  features: Record<string, AiProvider | "default">
  chatgpt_model: string
}
export interface ChatGPTStatus {
  available: boolean
  connected: boolean
  plan_enabled: boolean
  welcome_required: boolean
  pending: boolean
  email: string
  error: string
  features: Record<string, string>
  usage_url: string
}
export const getChatGPTStatus = () => requestJson<ChatGPTStatus>("/chatgpt/status")
export const getChatGPTModels = (signal?: AbortSignal) => requestJson<{ models: { id: string; name: string }[] }>("/chatgpt/models", { signal })
export interface ChatGPTUsageWindow {
  id: string
  name: string
  remaining_percent: number
  window_minutes: number | null
  resets_at: number | null
}
export interface ChatGPTUsage {
  available: boolean
  source: "codex"
  windows: ChatGPTUsageWindow[]
  updated_at: number | null
  error_code: string
  message: string
}
export const getChatGPTUsage = (signal?: AbortSignal, refresh = false) =>
  requestJson<ChatGPTUsage>(`/chatgpt/usage${refresh ? "/refresh" : ""}`, { signal })
export const chatGPTAction = (action: "connect" | "disconnect" | "cancel" | "welcome", reconsent = false) =>
  requestJson<ChatGPTStatus>(`/chatgpt/${action}`, { method: "POST", body: JSON.stringify({ reconsent }) })

export async function openChatGPTUsage() {
  const bridge = (window as Window & { ailsDesktop?: { api?: { open_external_url?: (url: string) => Promise<unknown> } } }).ailsDesktop?.api
  if (!bridge?.open_external_url) throw new Error("AILS 데스크톱 앱에서 열어 주세요.")
  await bridge.open_external_url("https://chatgpt.com/#settings/Usage")
}
