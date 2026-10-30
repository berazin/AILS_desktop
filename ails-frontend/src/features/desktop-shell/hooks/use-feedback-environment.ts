import { useCallback, useEffect, useRef, useState } from "react"
import { collectFeedbackEnvironment, type FeedbackBridge, type FeedbackEnvironment } from "../lib/feedback-environment.ts"

export function useFeedbackEnvironment(enabled: boolean) {
  const [environment, setEnvironment] = useState<FeedbackEnvironment | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef({ value: 0 })
  const bridge = (window as Window & { ailsDesktop?: { api?: FeedbackBridge } }).ailsDesktop?.api
  const refresh = useCallback(async () => {
    const request = ++generation.current.value
    setLoading(true)
    const next = await collectFeedbackEnvironment(bridge)
    if (request === generation.current.value) { setEnvironment(next); setLoading(false) }
    return next
  }, [bridge])

  useEffect(() => {
    if (!enabled) return
    const requests = generation.current
    void refresh()
    let timer: ReturnType<typeof setTimeout>
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh() }, 200) }
    window.addEventListener("resize", onResize)
    return () => { requests.value++; clearTimeout(timer); window.removeEventListener("resize", onResize) }
  }, [enabled, refresh])

  return { environment, loading, refresh }
}
