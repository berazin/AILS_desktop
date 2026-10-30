import { useEffect, useRef, useSyncExternalStore } from "react"
import { getChatGPTUsage, type ChatGPTUsage } from "../../../lib/api/chatgpt.ts"

type Snapshot = { data: ChatGPTUsage | null; loading: boolean; error: string }
let snapshot: Snapshot = { data: null, loading: false, error: "" }
const listeners = new Set<() => void>()
let controller: AbortController | null = null
let pending: Promise<void> | null = null
let interval: number | undefined
let lastStarted = 0

function publish(value: Snapshot) {
  snapshot = value
  listeners.forEach(listener => listener())
}

function refresh(force = false) {
  if (pending) return pending
  if (!listeners.size || (!force && Date.now() - lastStarted < 55_000)) return Promise.resolve()
  const current = new AbortController()
  controller = current
  lastStarted = Date.now()
  publish({ ...snapshot, loading: true })
  const timeout = window.setTimeout(() => current.abort(), 15_000)
  pending = getChatGPTUsage(current.signal, force).then(data => {
    if (controller !== current) return
    if (!Array.isArray(data.windows) || data.source !== "codex") throw new Error("잘못된 사용량 응답입니다.")
    publish({ data, loading: false, error: "" })
  }).catch(() => {
    if (controller === current) publish({ data: null, loading: false, error: "사용량을 확인할 수 없습니다. 다시 시도해 주세요." })
  }).finally(() => {
    window.clearTimeout(timeout)
    if (controller === current) { pending = null; controller = null }
  })
  return pending
}

function onVisibility() {
  if (!document.hidden) void refresh()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refresh()
    interval = window.setInterval(() => { if (!document.hidden) void refresh() }, 60_000)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("focus", onVisibility)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("focus", onVisibility)
      controller?.abort()
      controller = null; pending = null; lastStarted = 0
      snapshot = { data: null, loading: false, error: "" }
    }
  }
}

export function useChatGPTUsage(busy = false) {
  const state = useSyncExternalStore(subscribe, () => snapshot)
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && !busy) void refresh(true)
    wasBusy.current = busy
  }, [busy])
  return { ...state, refresh: () => refresh(true) }
}
