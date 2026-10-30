import { useEffect, useRef, useState } from "react"

import type { ExpertFallbackChoice, ExpertFallbackPrompt } from "../components/expert-fallback-dialog.tsx"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

export function useExpertFallbackWorkflow() {
  const [prompt, setPrompt] = useState<ExpertFallbackPrompt | null>(null)
  const resolverRef = useRef<((choice: ExpertFallbackChoice) => void) | null>(null)

  const request = useEventCallback((nextPrompt: ExpertFallbackPrompt) => {
    resolverRef.current?.("cancel")
    setPrompt(nextPrompt)
    return new Promise<ExpertFallbackChoice>((resolve) => {
      resolverRef.current = resolve
    })
  })

  const resolve = useEventCallback((choice: ExpertFallbackChoice) => {
    const resolvePending = resolverRef.current
    resolverRef.current = null
    setPrompt(null)
    resolvePending?.(choice)
  })

  useEffect(() => () => {
    resolverRef.current?.("cancel")
    resolverRef.current = null
  }, [])

  return { prompt, request, resolve }
}
