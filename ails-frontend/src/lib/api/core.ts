import type { AiProviderSettings } from "./chatgpt.ts"
import { createBackendReadiness } from "./desktop-backend-readiness.ts"

export interface AILSConfig {
  openrouter_web_search?: { enabled: boolean; engine: string }
  language?: 'korean' | 'english' | 'japanese' | 'chinese' | string
  video_vision_concurrency?: number
  video_frame_interval_seconds?: number
  ai_provider_settings?: AiProviderSettings
  ai_model_selection?: ModelSettings
  insight_book_reasoning_effort?: string
  voice_agent_provider?: 'local' | 'cloud'
  local_voice_agent_model?: 'auto' | 'qwen3-4b-instruct-2507-q4-k-m' | 'qwen3-8b-q4-k-m'
  ai_assist_cloud_fallback_policy?: 'manual' | 'automatic'
  local_problem_review_model?: 'auto' | 'qwen3-4b-instruct-2507-q4-k-m' | 'qwen3-8b-q4-k-m'
  pdf_ocr_model_variant?: 'auto' | 'tiny' | 'small' | 'medium'
  pdf_ocr_auto_review?: 'none' | 'local' | 'cloud'
  background_document_embedding?: boolean
  background_document_spacing?: boolean
  background_document_spacing_non_ails?: boolean
  background_document_ocr?: boolean
  background_document_ocr_non_ails?: boolean
  voice_vad_threshold?: number
  ails_auth_server_url?: string
  ails_auth_email?: string
  ails_device_id?: string
  problem_review_provider?: 'gateway'
  problem_review_model_name?: string
  problem_review_fallback_model_name?: string
  problem_review_budget_usd?: number
  md_save_path?: string
  python_kernel_executable?: string
  summary_provider?: string
  summary_model_name?: string
  summary_verification_enabled?: boolean
  video_summary_verification_enabled?: boolean
  summary_verification_web_search_enabled?: boolean
  summary_verification_reasoning_effort?: string
  ocr_provider?: string
  ocr_model_name?: string
  image_provider?: string
  image_model_name?: string
  image_secondary_provider?: string
  image_secondary_model_name?: string
  chatbot_zdr_enabled?: boolean
  stt_provider?: string
  stt_model_name?: string
  prompt_template?: string
  debug_trace_enabled?: boolean
  /* @ails-feature:developer_tools:start */
  phoenix_enabled?: boolean
  phoenix_endpoint?: string
  phoenix_project_name?: string
  /* @ails-feature:developer_tools:end */
  summary_fallback_on_quota?: boolean
  status_log_view_mode?: string
  max_parallel_summary_jobs?: number
  background_document_ocr_excluded_paths?: string[]
  [key: string]: unknown
}

export type ModelSelection =
  | { mode: 'managed_default' }
  | { mode: 'managed'; modelId: string }
  | { mode: 'local'; provider: string; modelId: string }

export interface ModelSettings {
  default: ModelSelection
  features: Record<string, ModelSelection>
}

export interface RetrievalState {
  document_id: string
  index_revision: string
  chunk_ids: string[]
  last_query?: string
  last_textbook_terms?: string
}

export interface DebugTraceEvent {
  time?: string
  updated_at?: string
  label?: string
  event_type?: string
  source?: "local" | "cloud" | "system"
  direction?: "input" | "output" | "event"
  model?: string
  content?: unknown
  [key: string]: unknown
}

export interface AILSStatus {
  is_running: boolean
  current_title: string
  current_task_id: number | null
  cancel_requested: boolean
  is_paused: boolean
  pause_reason?: string
  progress_percent?: number
  progress_label?: string
  progress_indeterminate?: boolean
  logs: string[]
  debug_events: DebugTraceEvent[]
}

export interface PendingTask {
  id: number
  title: string
  type: string
}

export interface ReportSummary {
  id: string
  title: string
  model: string
  status: string
  file_path: string
  updated_at?: number
}

export interface RetryCandidate {
  title: string
  task_type: string
  status?: "failed" | "needs_review"
  active: boolean
  logs?: string[]
  last_error?: string
}

export interface MaterialProblemProgress {
  solved: number
  total: number
}

export interface LectureMaterialReport {
  id: string
  title: string
  file_name: string
  file_path: string
  sequence: number
  updated_at?: number
  practice_set?: { set_id?: string; valid: boolean; question_count: number; errors?: string[] }
  problem_progress?: MaterialProblemProgress
  problem_progress_error?: string
}

export type MaterialKind = string

export interface LectureMaterialFile {
  id: string
  title: string
  file_name: string
  file_path: string
  kind: string
  updated_at?: number
  practice_set?: { set_id?: string; valid: boolean; question_count: number; errors?: string[] }
  problem_progress?: MaterialProblemProgress
  problem_progress_error?: string
}

export interface LectureMaterialWeek {
  week: number
  reports: LectureMaterialReport[]
}

export interface LectureMaterialFolder {
  name: string
  path: string
  updated_at?: number
  weeks: LectureMaterialWeek[]
  files: LectureMaterialFile[]
  children?: LectureMaterialFolder[]
  report_count: number
  direct_report_count?: number
  is_virtual?: boolean
  children_loaded?: boolean
  item_count?: number
}

export interface ActiveTaskStatus {
  task_id: number
  title: string
  type: string
  status: string
  started_at?: number
  is_paused: boolean
  pause_reason?: string
  cancel_requested: boolean
  progress_percent?: number
  progress_label?: string
  progress_indeterminate?: boolean
  logs: string[]
  debug_events: DebugTraceEvent[]
}

export interface LectureMaterialTrashItem {
  id: string
  name: string
  path: string
  kind: MaterialKind | "folder"
  is_dir: boolean
  updated_at?: number
  original_parent?: string | null
  original_name?: string | null
}

export interface LectureMaterialsPayload {
  base_path: string
  folders: LectureMaterialFolder[]
  trash?: LectureMaterialTrashItem[]
  directory_path?: string
  shallow?: boolean
}

export interface StatusPayload {
  status: AILSStatus
  active_tasks?: ActiveTaskStatus[]
  pending: PendingTask[]
  reports?: ReportSummary[]
  retry_candidates?: RetryCandidate[]
  config?: AILSConfig
  lite?: boolean
  reports_fingerprint?: string
  retry_candidates_fingerprint?: string
}

export class AILSApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = "AILSApiError"
    this.code = code
    this.status = status
  }
}

type AilsDesktopBridge = {
  api?: {
    localApiToken?: string
    backendPort?: number
    startupGateway?: boolean
    open_file_dialog?: (options: {
      title: string
      kind: string
      multiple?: boolean
      initial_dir?: string
    }) => Promise<{ path: string; paths: string[] }>
    open_directory_dialog?: (options: { title: string; initial_dir?: string }) => Promise<{ path: string; paths: string[] }>
  }
}

type AilsDesktopWindow = { ailsDesktop?: AilsDesktopBridge }

function resolveApiBase(): string {
  const envBase = import.meta.env?.VITE_AILS_API_BASE
  if (typeof envBase === "string" && envBase.trim()) {
    return envBase.trim().replace(/\/+$/, "")
  }

  const currentPort = typeof window !== "undefined" ? window.location?.port : ""

  try {
    const bridge = (window as unknown as AilsDesktopWindow).ailsDesktop
    const desktopPort = bridge?.api?.backendPort
    if (typeof desktopPort === "number" && Number.isFinite(desktopPort) && desktopPort > 0) {
      if (currentPort && currentPort === String(desktopPort)) {
        return "/api"
      }
      return `http://127.0.0.1:${desktopPort}/api`
    }
  } catch {
    // Ignore bridge lookup errors outside Electron.
  }

  if (typeof window !== "undefined" && window.location) {
    const hostname = window.location.hostname
    const isLoopback = hostname === "localhost" || hostname === "127.0.0.1"
    const backendPort = Number(import.meta.env?.VITE_AILS_PORT || 8765)
    if (isLoopback && currentPort && currentPort !== String(backendPort)) {
      return `http://127.0.0.1:${backendPort}/api`
    }
  }

  return "/api"
}

export const apiBase = resolveApiBase()

function readLocalApiToken(): string {
  try {
    const bridge = (window as unknown as AilsDesktopWindow).ailsDesktop
    return String(bridge?.api?.localApiToken ?? "").trim()
  } catch {
    return ""
  }
}

function desktopDialogApi(): NonNullable<NonNullable<AilsDesktopBridge["api"]>> | null {
  try {
    return (window as unknown as AilsDesktopWindow).ailsDesktop?.api ?? null
  } catch {
    return null
  }
}

const localApiToken = readLocalApiToken()

export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) }
  if (localApiToken && !headers["X-AILS-Token"]) headers["X-AILS-Token"] = localApiToken
  return headers
}

export function apiResourceUrl(path: string) {
  return `${apiBase}${path.startsWith("/") ? path : `/${path}`}`
}

const backendReadiness = createBackendReadiness(async () => {
  const response = await fetch(apiResourceUrl("/desktop-startup"), { headers: apiHeaders(), cache: "no-store" })
  if (!response.ok) throw new AILSApiError("로컬 서비스 상태를 확인하지 못했습니다.", "AILS_BACKEND_UNAVAILABLE", response.status)
  return response.json() as Promise<{ state: "starting" | "ready" | "failed" }>
})

export async function waitForLocalBackend(signal?: AbortSignal | null) {
  if (desktopDialogApi()?.startupGateway) await backendReadiness.wait(signal)
}

async function beforeApiRequest(init?: RequestInit) {
  init?.signal?.throwIfAborted()
  if (!desktopDialogApi()?.startupGateway) return
  if (["GET", "HEAD"].includes((init?.method || "GET").toUpperCase())) await backendReadiness.wait(init?.signal)
  else await backendReadiness.check()
  init?.signal?.throwIfAborted()
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  if (path !== "/desktop-startup") await beforeApiRequest(init)
  return fetchJson<T>(path, init)
}

/** Only the initial document metadata/content occupy gateway connections during
 * startup. Other reads keep the gate, leaving room for status and aborts. */
export function requestInitialDocumentJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  return fetchJson<T>(path, { signal })
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiResourceUrl(path), {
    ...init,
    headers: apiHeaders({
      "Content-Type": "application/json",
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    }),
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string }

  if (!response.ok) {
    const error = new AILSApiError(
      data.error ?? `API request failed: ${response.status}`,
      data.code ?? "",
      response.status,
    )
    if (error.code === "AI_CONSENT_REQUIRED") {
      window.dispatchEvent(new CustomEvent("ails:ai-consent-required"))
    }
    throw error
  }

  return data as T
}

export async function requestNdjsonStream<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit & { onEvent?: (event: T) => void },
): Promise<T[]> {
  const { onEvent, ...requestInit } = init ?? {}
  await beforeApiRequest(requestInit)
  const response = await fetch(apiResourceUrl(path), {
    ...requestInit,
    headers: apiHeaders({
      "Content-Type": "application/json",
      ...((requestInit?.headers as Record<string, string> | undefined) ?? {}),
    }),
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string }
    const error = new AILSApiError(
      data.error ?? `API request failed: ${response.status}`,
      data.code ?? "",
      response.status,
    )
    if (error.code === "AI_CONSENT_REQUIRED") {
      window.dispatchEvent(new CustomEvent("ails:ai-consent-required"))
    }
    throw error
  }
  if (!response.body) {
    throw new Error("Response body is not available for streaming.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const events: T[] = []

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const event = JSON.parse(trimmed) as T & { type?: string; error?: string }
    if (event.type === "error") {
      throw new Error(event.error || "Stream failed.")
    }
    events.push(event)
    onEvent?.(event)
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

  if (buffer.trim()) {
    handleLine(buffer)
  }

  return events
}

// 파일/폴더 선택은 Electron 네이티브 다이얼로그로만 제공한다. 네이티브 다이얼로그는
// 백엔드 프로세스를 거치지 않아 즉시 뜨고 DPI 스케일링 없이 선명하게 렌더링된다.
export function openFileDialog(payload: {
  kind: "audio" | "video" | "pdf" | "markdown" | "python" | string
  multiple?: boolean
  title?: string
  initial_dir?: string
}) {
  const dialogApi = desktopDialogApi()
  if (!dialogApi?.open_file_dialog) {
    return Promise.reject(new Error("파일 선택은 AILS 데스크톱 앱에서만 지원됩니다."))
  }
  return dialogApi.open_file_dialog({
    title: payload.title || "파일 선택",
    kind: payload.kind,
    multiple: payload.multiple,
    initial_dir: payload.initial_dir,
  })
}

export async function openDirectoryDialog(payload: { title?: string; initial_dir?: string }) {
  const dialogApi = desktopDialogApi()
  if (!dialogApi?.open_directory_dialog) {
    throw new Error("폴더 선택은 AILS 데스크톱 앱에서만 지원됩니다.")
  }
  const result = await dialogApi.open_directory_dialog({
    title: payload.title || "폴더 선택",
    initial_dir: payload.initial_dir,
  })
  return { path: result.path }
}

export interface LocalAiModelStatus {
  managed: boolean
  model_id: string
  model_label?: string
  ready: boolean
  installed?: boolean
  download_required: boolean
  update_available: boolean
  current_version?: string
  available_version?: string
  file_size: number
  required_files?: string[]
  license?: string
  purpose?: string
  download_urls?: string[]
  install_path?: string
}

export async function runPdfOperationStream(
  endpoint: string,
  payload: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  operationLabel: string,
  signal?: AbortSignal,
) {
  await beforeApiRequest({ method: "POST", signal })
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) throw new Error(`${operationLabel} request failed: ${response.status}`)
  if (!response.body) throw new Error(`${operationLabel} stream is not available.`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const dispatch = (line: string) => {
    if (!line.trim()) return
    const event = JSON.parse(line) as Record<string, unknown>
    if (event.type === 'error') throw new Error(String(event.error || `${operationLabel} failed.`))
    onEvent(event)
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) dispatch(line)
  }
  buffer += decoder.decode()
  dispatch(buffer)
}
