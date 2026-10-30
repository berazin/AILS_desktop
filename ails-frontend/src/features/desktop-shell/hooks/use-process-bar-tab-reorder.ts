import { useLayoutEffect, useRef, type RefObject } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { installTabReorder } from "../lib/process-bar-tab-reorder.ts"
import "../components/process-bar-tab-reorder.css"

export function useProcessBarTabReorder(containerRef: RefObject<HTMLDivElement | null>, layoutKey: string,
  onReorder?: (ids: string[]) => void) {
  const controller = useRef<ReturnType<typeof installTabReorder> | null>(null)
  const commit = useEventCallback((ids: string[]) => onReorder?.(ids))
  const enabled = Boolean(onReorder)
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) return
    const installed = installTabReorder(container, commit)
    controller.current = installed
    return () => { installed.dispose(); controller.current = null }
  }, [containerRef, commit, enabled])
  useLayoutEffect(() => { controller.current?.syncLayout() }, [layoutKey])
  return controller
}
