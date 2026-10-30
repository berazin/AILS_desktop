import { requestJson } from "./core.ts"
import type { AILSConfig, StatusPayload } from "./core.ts"
import type { ChatbotModelOption } from "./chatbot.ts"

export interface AILSOptions {
  stt_provider_options: string[]
  whisper_model_options: string[]
  whisper_cpp_model_options: string[]
  local_stt_runtime?: {
    providers: string[]
    faster_whisper_models: string[]
    whisper_cpp_models: string[]
    directml_whisper_models: string[]
    acceleration: "vulkan-only" | "vulkan-preferred" | "excluded"
    execution_provider: "Vulkan preferred" | null
    decoder_execution_provider: "Vulkan preferred" | null
    model_bundled: boolean
    model_downloadable: boolean
    cpu_fallback: boolean
  }
  status_log_view_options: string[]
}

export interface ModelOptionsPayload {
  models: Record<string, string[]>
  errors?: Record<string, string>
  chatbot_agent_models?: ChatbotModelOption[]
  chatbot_expert_models?: ChatbotModelOption[]
  chatbot_expert_auto_model_id?: string
}

export interface EditionPayload {
  id: "personal" | "developer" | "commercial" | "general"
  display_name: string
  features: Record<string, boolean>
  manifest_sha256: string
}

export function getStatus(options?: { scanDisk?: boolean; lite?: boolean }) {
  const params = new URLSearchParams()
  if (options?.scanDisk) params.set("scan_disk", "1")
  if (options?.lite && !options.scanDisk) params.set("lite", "1")
  const query = params.toString()
  return requestJson<StatusPayload>(query ? `/status?${query}` : "/status")
}

export function getEdition() {
  return requestJson<EditionPayload>("/edition")
}

export function getOptions() {
  return requestJson<AILSOptions>("/options")
}

export function getModelOptions(config?: AILSConfig) {
  if (config) {
    return requestJson<ModelOptionsPayload>("/model-options", {
      method: "POST",
      body: JSON.stringify({ config }),
    })
  }
  return requestJson<ModelOptionsPayload>("/model-options")
}

export function getConfig() {
  return requestJson<{ config: AILSConfig }>("/config")
}

export function getDefaultConfig() {
  return requestJson<{ config: AILSConfig }>("/config/defaults")
}

export function saveConfig(config: AILSConfig) {
  return requestJson<{ config: AILSConfig }>("/config", {
    method: "POST",
    body: JSON.stringify({ config }),
  })
}

export function openLocalPath(path: string) {
  return requestJson<{ opened: boolean; path: string }>("/system/open-path", {
    method: "POST",
    body: JSON.stringify({ path }),
  })
}

export function openDistributionLicenses() {
  return requestJson<{ opened: boolean; path: string }>("/system/open-licenses", {
    method: "POST",
    body: JSON.stringify({}),
  })
}
