type Stage = "submit" | "preflight_start" | "preflight_ready" | "request_start" | "headers" |
  "first_token" | "first_ui_update" | "first_ui_commit" | "done" | "stream_end" |
  "save_start" | "save_end" | "finished" | "cancelled" | "failed"
type Record = { id: string; stages: Partial<{ [S in Stage]: number }>; backendRequests: string[] }
const records = new Map<string, { start: number; value: Record }>()

// Bounded, memory-only diagnostics. IDs are generated turn IDs, never document paths.
export function startChatLatency(id: string, start = performance.now()) {
  if (!/^[a-f0-9-]{36}-assistant$/.test(id)) return
  records.set(id, { start, value: { id, stages: { submit: 0 }, backendRequests: [] } })
  if (records.size > 100) records.delete(records.keys().next().value!)
}
export function markChatLatency(id: string, stage: Stage) {
  const entry = records.get(id)
  if (entry && entry.value.stages[stage] === undefined) entry.value.stages[stage] = performance.now() - entry.start
}
export function linkChatLatency(id: string, requestId: unknown) {
  const entry = records.get(id)
  if (entry && typeof requestId === "string" && /^[a-f0-9-]{36}$/.test(requestId) && entry.value.backendRequests.length < 20) {
    entry.value.backendRequests.push(requestId)
  }
}
export function chatLatencySnapshot() {
  return structuredClone([...records.values()].map(entry => entry.value))
}
