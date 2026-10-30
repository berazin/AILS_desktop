import { useEffect, useRef } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

export function usePdfTextToolsDismissal(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = useEventCallback(onClose)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      // The fullscreen trigger shares this state and must finish its own toggle.
      if (target.closest("[data-ails-pdf-text-tools-trigger]")) return
      close()
    }
    document.addEventListener("pointerdown", dismiss, true)
    return () => document.removeEventListener("pointerdown", dismiss, true)
  }, [open, close])

  return { panelRef, triggerRef }
}
