import { useState } from "react"

import {
  normalizeDebugTraceEvent,
  stringifyDebugValue,
  type DebugTraceEvent,
  type DebugTraceFilter,
} from "../lib/debug-trace.ts"
import { writeClipboardText } from "../lib/clipboard.ts"
import { t } from "../../../lib/i18n.ts"

type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
  onError?: (error: unknown) => void,
) => Promise<void>

type UseDebugTraceWorkflowOptions = {
  events: Record<string, unknown>[]
  runInteraction: RunInteraction
}

function formatDebugTrace(events: DebugTraceEvent[]) {
  return events
    .map((event, index) => {
      const metadata = [event.source, event.direction, event.eventType, event.model].filter(Boolean).join(" · ")
      return [
        `#${index + 1} ${event.label}${event.time ? ` ${event.time}` : ""}`,
        metadata,
        stringifyDebugValue(event.content),
      ].filter(Boolean).join("\n")
    })
    .join("\n\n---\n\n")
}

export function useDebugTraceWorkflow({ events, runInteraction }: UseDebugTraceWorkflowOptions) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<DebugTraceFilter>("all")
  const normalizedEvents = events.map(normalizeDebugTraceEvent)
  const filteredEvents = filter === "all"
    ? normalizedEvents
    : normalizedEvents.filter((event) => event.source === filter)
  const text = formatDebugTrace(normalizedEvents)
  const filteredText = formatDebugTrace(filteredEvents)

  async function copy(copyText = text, eventCount = normalizedEvents.length) {
    await runInteraction("copy-debug", t("디버그 추적 복사"), async () => {
      await writeClipboardText(copyText)
      return eventCount ? t("디버그 추적 내용을 복사했습니다.") : t("복사할 디버그 추적 내용이 없습니다.")
    })
  }

  return {
    copy,
    filter,
    filteredEvents,
    filteredText,
    open,
    setFilter,
    setOpen,
    text,
  }
}

export type DebugTraceWorkflow = ReturnType<typeof useDebugTraceWorkflow>
