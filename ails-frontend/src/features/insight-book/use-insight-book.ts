import { useCallback, useEffect, useRef, useState } from "react"
import { getInsightBook, insightAction, submitInsight, type InsightSnapshot, type ReviewFilter } from "./api.ts"

export function useInsightBook({ mode = "book" }: { mode?: "book" | "submit" } = {}) {
  const [snapshot, setSnapshot] = useState<InsightSnapshot | null>(null)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [rawOffset, setRawOffset] = useState(0)
  const [revisionOffset, setRevisionOffset] = useState(0)
  const [reviewFilter, selectReviewFilter] = useState<ReviewFilter>("pending")
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const generation = useRef(0)
  const refreshing = useRef<AbortController | null>(null)
  const accountScope = useRef("")
  // Keep an idempotency ID when a network failure makes submission outcome unknown.
  const requests = useRef(new Map<string, string>())
  const refresh = useCallback(async () => {
    if (mode === "submit") return
    const version = ++generation.current
    refreshing.current?.abort()
    const controller = new AbortController()
    refreshing.current = controller
    try {
      const result = await getInsightBook(controller.signal, rawOffset, revisionOffset, reviewFilter)
      if (alive.current && version === generation.current) {
        if (accountScope.current && accountScope.current !== result.account_scope) {
          setSnapshot(null)
          setError("계정이 변경되었습니다. 이 창을 닫고 Insight Book을 다시 열어주세요.")
          return
        }
        accountScope.current = result.account_scope
        if (rawOffset > 0 && result.review_count !== undefined && rawOffset >= result.review_count) {
          setRawOffset(Math.max(0, Math.floor((result.review_count - 1) / 100) * 100))
          return
        }
        setSnapshot(result)
        setError("")
      }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted && version === generation.current) {
        setSnapshot(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (refreshing.current === controller) refreshing.current = null
    }
  }, [mode, rawOffset, revisionOffset, reviewFilter])
  useEffect(() => {
    alive.current = true
    let interval: number | undefined
    if (mode === "book") {
      void refresh()
      interval = window.setInterval(() => { if (!refreshing.current) void refresh() }, 3000)
    }
    return () => {
      alive.current = false
      window.clearInterval(interval)
      refreshing.current?.abort()
    }
  }, [mode, refresh])

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setActionError("")
    try {
      await operation()
      if (alive.current) await refresh()
      return true
    } catch (cause) {
      if (alive.current) setActionError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [refresh])
  const keyFor = useCallback((payload: unknown) => {
    const key = JSON.stringify(payload)
    if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID())
    return requests.current.get(key)!
  }, [])
  const submit = useCallback((text: string, parentId?: string) => {
    const body = { text, sources: [], parent_id: parentId, approve_correction: Boolean(parentId) }
    return run(async () => { await submitInsight({ ...body, request_id: keyFor(body) }); if (alive.current) setRawOffset(0) })
  }, [keyFor, run])
  const action = useCallback((body: Record<string, unknown>) => run(async () => {
    const key = JSON.stringify(body)
    await insightAction({ ...body, request_id: keyFor(body) })
    requests.current.delete(key)
  }), [keyFor, run])
  const setReviewFilter = useCallback((value: ReviewFilter) => {
    if (value === reviewFilter && rawOffset === 0) return
    refreshing.current?.abort()
    generation.current++
    selectReviewFilter(value)
    setRawOffset(0)
  }, [reviewFilter, rawOffset])
  return { snapshot, error: error || actionError, busy, refresh, submit, action, rawOffset, setRawOffset, revisionOffset, setRevisionOffset, reviewFilter, setReviewFilter }
}
