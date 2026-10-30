import { useLayoutEffect, useRef, useState } from "react"
import type { MaterialContextTarget } from "../../../lib/material-navigation.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

export type PracticePdfFileNavigation = {
  previous: MaterialContextTarget | null
  next: MaterialContextTarget | null
  open: (path: string) => void | Promise<unknown>
}

export function usePracticePdfFiles({ enabled, pdfPath, blocked, navigation, beforeOpen, onError }: {
  enabled: boolean
  pdfPath: string
  blocked: boolean
  navigation?: PracticePdfFileNavigation
  beforeOpen: () => boolean | Promise<boolean>
  onError: (error: unknown) => void
}) {
  const [busy, setBusy] = useState(false)
  const pendingRef = useRef(false)
  const mountedRef = useRef(false)
  const scopeRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useLayoutEffect(() => {
    scopeRef.current = enabled ? pdfPath : null
    return () => { scopeRef.current = null }
  }, [enabled, pdfPath])

  const open = useEventCallback(async (direction: -1 | 1) => {
    const target = direction === -1 ? navigation?.previous : navigation?.next
    const scope = scopeRef.current
    if (!enabled || blocked || pendingRef.current || !target || !navigation || !scope) return
    pendingRef.current = true
    setBusy(true)
    try {
      if (!await beforeOpen() || scopeRef.current !== scope) return
      await navigation.open(target.path)
    } catch (error) {
      if (scopeRef.current === scope) onError(error)
    } finally {
      pendingRef.current = false
      if (mountedRef.current) setBusy(false)
    }
  })

  return { previous: navigation?.previous ?? null, next: navigation?.next ?? null, busy: busy || blocked, open }
}

export type PracticePdfFileControls = ReturnType<typeof usePracticePdfFiles>
