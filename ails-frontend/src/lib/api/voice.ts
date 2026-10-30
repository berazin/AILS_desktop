import { apiBase, apiHeaders, requestJson, runPdfOperationStream } from "./core.ts"
import type { ChatbotResponse, ChatbotUsage } from "./chatbot.ts"

export interface VoiceStatus {
  ready: boolean
  runtime_ready: boolean
  runtime_version: string
  core_version: string
  runtime_error: string
  model_id: string
  download_required: boolean
  update_available: boolean
  file_size: number
  backend: string
  precision: string
  vad: string
  selected_model: string
  execution_provider: "Vulkan" | "CPU"
  use_vulkan: boolean
  two_pass: boolean
  first_pass: string
}

export interface VoiceRecognitionResult {
  partial?: string
  finals: string[]
  text: string
  speech_detected?: boolean
}

export function getVoiceStatus() {
  return requestJson<VoiceStatus>("/voice/status")
}

export function downloadVoiceModelStream(onEvent: (event: Record<string, unknown>) => void, signal?: AbortSignal) {
  return runPdfOperationStream('/voice/model/download/stream', { confirmed: true }, onEvent, 'Voice model download', signal)
}

export function downloadVoiceAgentModelStream(
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
  options?: { model_id?: string },
) {
  return runPdfOperationStream(
    '/voice/agent/model/download/stream',
    { confirmed: true, ...(options?.model_id ? { model_id: options.model_id } : {}) },
    onEvent,
    'Voice agent model download',
    signal,
  )
}

export function startVoiceSession() {
  return requestJson<{ session_id: string; sample_rate: number; backend: string; model: string }>("/voice/start", {
    method: "POST",
    body: "{}",
  })
}

export function sendVoiceChunk(payload: {
  session_id: string
  sample_rate: number
  pcm16_base64: string
  speech_state: "idle" | "started" | "active" | "ended"
}) {
  return requestJson<VoiceRecognitionResult>("/voice/chunk", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function stopVoiceSession(sessionId: string) {
  return requestJson<VoiceRecognitionResult>("/voice/stop", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export function flushVoiceSession(sessionId: string) {
  return requestJson<{ flushed: boolean }>("/voice/flush", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export function cancelVoiceSession(sessionId: string) {
  return requestJson<{ cancelled: boolean }>("/voice/cancel", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId }),
  })
}

export type RealtimeVoiceToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type RealtimeVoiceToolResult = {
  tool_call_id: string
  content: string
}

export type RealtimeVoiceToolRound = {
  calls: RealtimeVoiceToolCall[]
  results: RealtimeVoiceToolResult[]
}

export type RealtimeVoiceContext = {
  document_title: string
  current_page: number
  page_count: number
  pdf_open: boolean
  practice_open: boolean
  problem_count: number
  ocr_active: boolean
  selected_text: string
  workspace_surface: string
  document_kind: string
  sidebar_visible: boolean
  chatbot_open: boolean
  settings_open: boolean
  help_open: boolean
  edit_mode: boolean
  fullscreen: boolean
}

export type RealtimeVoiceResponse = ChatbotResponse & { first_event_ms?: number | null }

export function warmupRealtimeVoiceAgent() {
  return requestJson<{ warmed: boolean; provider: string; elapsed_ms: number }>("/voice/agent/warmup", {
    method: "POST",
    body: JSON.stringify({ work_acknowledged: true }),
  })
}

export async function streamRealtimeVoiceAgent(
  payload: {
    transcript: string
    work_acknowledged: true
    assist_mode?: boolean
    force_cloud?: boolean
    context: RealtimeVoiceContext
    tool_rounds: RealtimeVoiceToolRound[]
  },
  handlers: {
    onToken?: (token: string) => void
    onToolCall?: (call: RealtimeVoiceToolCall) => void
    onDone?: (response: RealtimeVoiceResponse) => void
  } = {},
  signal?: AbortSignal,
): Promise<RealtimeVoiceResponse> {
  const response = await fetch(`${apiBase}/voice/agent/stream`, {
    method: "POST",
    headers: apiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `API request failed: ${response.status}`)
  }
  if (!response.body) throw new Error("Realtime voice stream is not available in this browser.")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let doneEvent: RealtimeVoiceResponse | null = null
  const handleLine = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as Record<string, unknown>
    if (event.type === "token") handlers.onToken?.(String(event.token ?? ""))
    else if (event.type === "tool_call") {
      handlers.onToolCall?.({
        id: String(event.id ?? ""),
        name: String(event.name ?? ""),
        arguments: event.arguments && typeof event.arguments === "object"
          ? event.arguments as Record<string, unknown>
          : {},
      })
    } else if (event.type === "done") {
      doneEvent = {
        answer: String(event.answer ?? ""),
        model: String(event.model ?? ""),
        provider: String(event.provider ?? ""),
        answer_source: event.answer_source === "local" ? "local" : event.answer_source === "cloud" ? "cloud" : undefined,
        cloud_mode: event.cloud_mode === "supplement" ? "supplement" : event.cloud_mode === "fallback" ? "fallback" : undefined,
        cloud_reason: event.cloud_reason ? String(event.cloud_reason) : undefined,
        usage: event.usage as ChatbotUsage | undefined,
        first_event_ms: typeof event.first_event_ms === "number" ? event.first_event_ms : null,
      }
      handlers.onDone?.(doneEvent)
    } else if (event.type === "error") throw new Error(String(event.error ?? "Realtime voice stream failed."))
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) handleLine(line)
  }
  buffer += decoder.decode()
  if (buffer.trim()) handleLine(buffer)
  if (!doneEvent) throw new Error("Realtime voice stream ended before completion.")
  return doneEvent
}
