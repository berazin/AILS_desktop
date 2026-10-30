import { apiBase, apiHeaders, requestJson } from "./core.ts"
import type { LocalAiModelStatus, RetrievalState } from "./core.ts"
import type { RealtimeVoiceToolCall, RealtimeVoiceToolRound } from "./voice.ts"

export async function ensurePracticeTutorSupport(): Promise<void> {
  try {
    const capabilities = await requestJson<{ context_version: number }>("/chatbot/practice-tutor-capabilities")
    if (capabilities.context_version === 1) return
  } catch {
    // An older backend must never silently process a tutor turn as normal RAG.
  }
  throw new Error("AI 튜터 문맥 보호 기능을 확인할 수 없습니다. AILS 백엔드를 다시 시작한 뒤 재시도해 주세요.")
}

export interface WebSearchReport {
  engine: string
  requests: number | null
  status: "searched" | "not_searched" | "unreported"
  sources: Array<{ url: string; title: string }>
}

export interface ChatbotUsage {
  web_search?: WebSearchReport
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  cached_input_tokens?: number
  thought_tokens?: number
  cost?: number
  actual_cost_usd?: number
  source?: string
}

/** 한 질문의 모든 라운드 사용량 합산(프런트 계산) + 마지막 usage 원본 */
export interface ChatbotUsageTotal {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
  cached_input_tokens?: number
  thought_tokens?: number
  cost?: number
  actual_cost_usd?: number
  calls: number
  source: 'api' | 'estimated' | 'mixed'
  last_usage?: ChatbotUsage
}

/** 백엔드가 done 이벤트에 실어 보내는 문맥 지표 */
export interface ChatbotContextMetrics {
  evidence?: import("../../features/chat/lib/answer-evidence.ts").AnswerEvidence[]
  request_id?: string
  profile: string
  input_budget: { default: number; effective: number; hard_cap: number }
  section_tokens: {
    system: number
    conversation: number
    dynamic_context: number
    question: number
    tool_rounds: number
    tool_schemas: number
    rag?: number
  }
  total_input_tokens: number
  tools: { count: number; schema_tokens: number; categories_selected: string[] }
  reductions: {
    dropped_conversation_turns: number
    dropped_memory_items: number
    dropped_rag_excerpts: number
    truncated_tool_results: number
    tool_result_tokens_before: number
    tool_result_tokens_after: number
  }
  cache: { assembly_cache_hit: boolean; prefix_message_ratio: number | null }
  round_index?: number
  prepare_ms?: number
  first_event_ms?: number
  model_first_event_ms?: number
  provider?: string
  provider_source?: 'response_header' | 'configured'
  retry_count?: number
  fallback_count?: number
  provider_request_start_ms?: number | null
  headers_received_ms?: number | null
  first_sse_event_ms?: number | null
  first_content_ms?: number | null
  session_request_start_ms?: number | null
  session_ready_ms?: number | null
  response_completed_ms?: number | null
  settlement_start_ms?: number | null
  settlement_completed_ms?: number | null
  total_ms?: number
}

export function mergeChatbotUsageTotals(usages: Array<ChatbotUsage | undefined>): ChatbotUsageTotal | undefined {
  const seen = usages.filter((usage): usage is ChatbotUsage => Boolean(usage))
  if (!seen.length) return undefined
  const total: ChatbotUsageTotal = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    calls: seen.length,
    source: 'api',
    last_usage: seen[seen.length - 1],
  }
  const hasCacheHit = seen.some((usage) => typeof usage.prompt_cache_hit_tokens === 'number')
  const hasCacheMiss = seen.some((usage) => typeof usage.prompt_cache_miss_tokens === 'number')
  const hasCachedInput = seen.some((usage) => typeof usage.cached_input_tokens === 'number')
  const hasThought = seen.some((usage) => typeof usage.thought_tokens === 'number')
  const hasCost = seen.some((usage) => typeof usage.cost === 'number' || typeof usage.actual_cost_usd === 'number')

  if (hasCacheHit) total.prompt_cache_hit_tokens = 0
  if (hasCacheMiss) total.prompt_cache_miss_tokens = 0
  if (hasCachedInput) total.cached_input_tokens = 0
  if (hasThought) total.thought_tokens = 0
  if (hasCost) {
    total.cost = 0
    total.actual_cost_usd = 0
  }

  for (const usage of seen) {
    total.input_tokens += usage.input_tokens ?? 0
    total.output_tokens += usage.output_tokens ?? 0
    total.total_tokens += usage.total_tokens ?? 0
    if (typeof usage.prompt_cache_hit_tokens === 'number') {
      total.prompt_cache_hit_tokens = (total.prompt_cache_hit_tokens ?? 0) + usage.prompt_cache_hit_tokens
    }
    if (typeof usage.prompt_cache_miss_tokens === 'number') {
      total.prompt_cache_miss_tokens = (total.prompt_cache_miss_tokens ?? 0) + usage.prompt_cache_miss_tokens
    }
    if (typeof usage.cached_input_tokens === 'number') {
      total.cached_input_tokens = (total.cached_input_tokens ?? 0) + usage.cached_input_tokens
    }
    if (typeof usage.thought_tokens === 'number') {
      total.thought_tokens = (total.thought_tokens ?? 0) + usage.thought_tokens
    }
    if (typeof usage.cost === 'number' || typeof usage.actual_cost_usd === 'number') {
      const costVal = typeof usage.cost === 'number' ? usage.cost : (usage.actual_cost_usd ?? 0)
      total.cost = (total.cost ?? 0) + costVal
      total.actual_cost_usd = (total.actual_cost_usd ?? 0) + costVal
    }
    if (usage.source === 'estimated' && total.source === 'api') total.source = 'mixed'
  }
  if (seen.every((usage) => usage.source === 'estimated')) total.source = 'estimated'
  return total
}

export type ChatTextVerbosity = "low" | "medium" | "high"

export interface ChatbotPayload {
  reasoning_effort?: string
  text_verbosity?: ChatTextVerbosity
  question: string
  context: string
  /** context가 사용자가 직접 선택한 텍스트일 때 true — 백엔드 RAG 발췌로 대체하지 않음 */
  context_is_selection?: boolean
  context_pages?: number[]
  history: import("./practice-tutor.ts").PracticeChatHistoryEntry[]
  practice_context?: import("./practice-tutor.ts").PracticeTutorContext
  assist_mode?: boolean
  force_cloud?: boolean
  cloud_fallback_policy?: 'manual' | 'automatic'
  document_id?: string
  selection_context?: string
  retrieval_state?: RetrievalState
  enable_tools?: boolean
  tool_rounds?: RealtimeVoiceToolRound[]
  /** 한 질문의 전체 라운드에서 동일 — 백엔드 기본 조립(고정 system·대화·검색) 재사용 키 */
  turn_id?: string
}

export interface ChatbotResponse {
  answer: string
  model: string
  provider: string
  answer_source?: 'local' | 'cloud'
  cloud_mode?: 'supplement' | 'fallback'
  cloud_recommended?: boolean
  cloud_reason?: string
  retrieval_state?: RetrievalState
  usage?: ChatbotUsage
  context_metrics?: ChatbotContextMetrics
}

export interface SearchContextResponse {
  status: 'ready' | 'partial' | 'indexing' | 'unavailable'
  chunks: Array<{
    id: string
    text: string
    page?: number
    section?: string
    score: number
  }>
  retrieval_state?: RetrievalState
}

export interface ChatbotStreamHandlers {
  onTiming?: (stage: "request_start" | "headers" | "first_token" | "done" | "stream_end") => void
  onReset?: () => void
  onToken?: (token: string) => void
  onToolCall?: (call: RealtimeVoiceToolCall) => void
  onDone?: (event: ChatbotResponse) => void
}

export interface ChatbotModelOption {
  id: string
  name: string
  provider: string
  input_price: number
  output_price: number
  available: boolean
  local?: boolean
}

export interface ChatbotExpertResult {
  ok: boolean
  answer?: string
  model?: string
  provider?: string
  usage?: ChatbotUsage
  fallback_required?: boolean
  error?: string
  failed_model?: string
  selected_model?: string
  recommended_model?: string
}

export interface ModelTestPayload {
  feature: string
  provider: string
  model_name: string
  endpoint?: string
  api_key?: string
}

export function askChatbot(payload: ChatbotPayload) {
  return requestJson<ChatbotResponse>("/chatbot", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function askChatbotExpert(payload: {
  question: string
  context?: string
  model_name?: string
  confirmed?: boolean
}) {
  return requestJson<ChatbotExpertResult>("/chatbot/expert", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function askChatbotStream(
  payload: ChatbotPayload,
  handlers: ChatbotStreamHandlers = {},
  signal?: AbortSignal,
): Promise<ChatbotResponse> {
  handlers.onTiming?.("request_start")
  const response = await fetch(`${apiBase}/chatbot/stream`, {
    method: "POST",
    headers: apiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    signal,
  })
  handlers.onTiming?.("headers")
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `API request failed: ${response.status}`)
  }
  if (!response.body) {
    throw new Error("Chatbot stream is not available in this browser.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let doneEvent: ChatbotResponse | null = null
  let firstTokenObserved = false

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const event = JSON.parse(trimmed) as Record<string, unknown>
    if (event.type === "reset") {
      handlers.onReset?.()
      return
    }
    if (event.type === "token") {
      const token = String(event.token ?? "")
      if (token) {
        if (!firstTokenObserved) {
          firstTokenObserved = true
          handlers.onTiming?.("first_token")
        }
        handlers.onToken?.(token)
      }
      return
    }
    if (event.type === "tool_call") {
      handlers.onToolCall?.({
        id: String(event.id ?? ""),
        name: String(event.name ?? ""),
        arguments: event.arguments && typeof event.arguments === "object"
          ? event.arguments as Record<string, unknown>
          : {},
      })
      return
    }
    if (event.type === "done") {
      const nextDoneEvent: ChatbotResponse = {
        answer: String(event.answer ?? ""),
        model: String(event.model ?? ""),
        provider: String(event.provider ?? ""),
        answer_source: event.answer_source === "local" ? "local" : event.answer_source === "cloud" ? "cloud" : undefined,
        cloud_mode: event.cloud_mode === "supplement" ? "supplement" : event.cloud_mode === "fallback" ? "fallback" : undefined,
        cloud_recommended: event.cloud_recommended === true,
        cloud_reason: event.cloud_reason ? String(event.cloud_reason) : undefined,
        retrieval_state: event.retrieval_state as RetrievalState | undefined,
        usage: event.usage as ChatbotUsage | undefined,
        context_metrics: event.context_metrics && typeof event.context_metrics === "object"
          ? event.context_metrics as ChatbotContextMetrics
          : undefined,
      }
      handlers.onTiming?.("done")
      doneEvent = nextDoneEvent
      handlers.onDone?.(nextDoneEvent)
      return
    }
    if (event.type === "error") {
      const error = new Error(String(event.error ?? "Chatbot stream failed."))
      if (event.code) (error as Error & { code?: string }).code = String(event.code)
      throw error
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      handleLine(line)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    handleLine(buffer)
  }
  if (!doneEvent) {
    throw new Error("Chatbot stream ended before the final response.")
  }
  handlers.onTiming?.("stream_end")
  return doneEvent
}

export function testModelConnection(payload: ModelTestPayload) {
  return requestJson<{ ok: boolean; message: string; preview?: string; usage?: ChatbotUsage }>("/model-test", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function saveChatbotAnswer(payload: {
  title: string
  answer: string
  target_file_path?: string
  insert_line_index?: number
}) {
  return requestJson<{
    title: string
    file_path: string
    markdown_link: string
    updated_content?: string | null
    updated_raw_content?: string | null
  }>("/chatbot/save-answer", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function searchContext(payload: {
  action: 'search' | 'reuse'
  document_id: string
  query?: string
  textbook_terms?: string
  top_k?: number
  retrieval_state?: RetrievalState
}) {
  return requestJson<SearchContextResponse>("/search/context", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export interface AiAssistStatus extends Partial<LocalAiModelStatus> {
  resident: boolean
  active_model_id: string
  response?: string
  warmed?: boolean
  provider?: string
  elapsed_ms?: number
}

export function getAiAssistStatus() {
  return requestJson<AiAssistStatus>("/assist/status")
}

export function warmupAiAssist(options: { model_id?: string } = {}) {
  return requestJson<AiAssistStatus>("/assist/warmup", {
    method: "POST",
    body: JSON.stringify(options),
  })
}

export function stopAiAssist() {
  return requestJson<{ stopped: boolean; resident?: boolean }>("/assist/stop", {
    method: "POST",
  })
}
