import { requestJson, requestNdjsonStream } from "./core.ts"

export type LocalAiPriority = "balanced" | "quality" | "speed"
export interface LocalAiStatus {
  tool: { ready: boolean; version: string; install_supported: boolean; download_bytes: number; license: string }
  runtime: { ready: boolean; name: string; error: string }
  installed: Array<{ id: string; name: string; size: number }>
}
export interface LocalAiModel {
  id: string
  name: string
  catalog_id: string
  quantization: string
  filename: string
  download_bytes: number
  context: number
  max_context: number
  memory_gb: number
  estimated_tps: number
  execution: string
  llmfit_rank: number
  scores: Record<LocalAiPriority, number>
  license: string | null
  reasons: string[]
  model_url: string
}
export interface LocalAiReport extends LocalAiStatus {
  system: { os?: string; cpu_name?: string; cpu_cores?: number; total_ram_gb?: number; available_ram_gb?: number;
    gpu_name?: string; gpu_vram_gb?: number; unified_memory?: boolean; shared_memory_detected?: boolean; backend?: string }
  models: LocalAiModel[]
  warnings: string[]
  context: number
}
export interface LocalAiVerification { ok: boolean; source_model: string; quantization: string; measured_tps: number | null; gpu_used: boolean | null; runtime_context: number | null; duration_seconds: number; measured_at: string }
export interface LocalAiProgress { type: string; status?: string; total?: number; completed?: number; model?: string; verification?: LocalAiVerification }
export interface LocalAiSelection { model_id: string; source_model: string; context: number }
export const getLocalAiStatus = (signal?: AbortSignal) => requestJson<LocalAiStatus>("/local-ai/status", { signal })
export const analyzeLocalAi = (refresh = false, signal?: AbortSignal) =>
  requestJson<LocalAiReport>("/local-ai/analyze", { method: "POST", body: JSON.stringify({ refresh }), signal })
export const selectLocalAi = (model: string) =>
  requestJson<LocalAiSelection>("/local-ai/select", { method: "POST", body: JSON.stringify({ model }) })

export async function downloadLocalAi(action: "tool" | "pull" | "verify", model: string | undefined,
  onEvent: (event: LocalAiProgress) => void, signal: AbortSignal) {
  let complete = false
  let verification: LocalAiVerification | undefined
  await requestNdjsonStream<LocalAiProgress>(`/local-ai/${action}/stream`, {
    method: "POST", body: JSON.stringify({ confirmed: true, model }), signal,
    onEvent: event => { if (event.type === "done") { complete = true; verification = event.verification }; onEvent(event) },
  })
  if (!complete) throw new Error("설치 완료를 확인하지 못했습니다. 상태를 새로 확인해 주세요.")
  if (action === "verify" && !verification?.ok) throw new Error("모델 실행 확인 결과를 받지 못했습니다. 다시 확인해 주세요.")
  return verification
}
