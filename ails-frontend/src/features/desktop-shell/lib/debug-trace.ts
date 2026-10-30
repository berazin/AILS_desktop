export function stringifyDebugValue(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export type DebugTraceFilter = "all" | "local" | "cloud"
type DebugTraceSource = Exclude<DebugTraceFilter, "all"> | "system"
type DebugTraceDirection = "input" | "output" | "event"

export type DebugTraceEvent = {
  content: unknown
  direction: DebugTraceDirection
  eventType: string
  label: string
  model: string
  source: DebugTraceSource
  time: string
}

export function normalizeDebugTraceEvent(event: Record<string, unknown>, index: number): DebugTraceEvent {
  const label = String(event.label ?? event.name ?? event.type ?? event.stage ?? `event-${index + 1}`)
  const eventType = String(event.event_type ?? event.type ?? "info").toLocaleLowerCase()
  const sourceValue = String(event.source ?? "").toLocaleLowerCase()
  const loweredLabel = label.toLocaleLowerCase()
  const source: DebugTraceSource = sourceValue === "local" || sourceValue === "cloud" || sourceValue === "system"
    ? sourceValue
    : /llama\.cpp|lm studio|local/.test(loweredLabel)
      ? "local"
      : /gemini|groq|deepseek|vercel|gateway|managed/.test(loweredLabel)
        ? "cloud"
        : "system"
  const directionValue = String(event.direction ?? "").toLocaleLowerCase()
  const direction: DebugTraceDirection = directionValue === "input" || directionValue === "output" || directionValue === "event"
    ? directionValue
    : ["prompt", "request", "input"].includes(eventType)
      ? "input"
      : ["token", "response", "output", "tool_call", "error"].includes(eventType)
        ? "output"
        : "event"
  return {
    content: event.content ?? event.text ?? event.prompt ?? event.response ?? event.message ?? event,
    direction,
    eventType,
    label,
    model: String(event.model ?? ""),
    source,
    time: String(event.time ?? event.created_at ?? event.timestamp ?? ""),
  }
}
