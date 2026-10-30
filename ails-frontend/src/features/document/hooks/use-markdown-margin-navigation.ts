import { useEffect, type RefObject } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

/** Navigate only the blank columns outside the current Markdown reader. */
export function useMarkdownMarginNavigation({ enabled, documentId, containerRef, previousPath, nextPath, onOpen }: {
  enabled: boolean; documentId?: string; containerRef?: RefObject<HTMLElement | null>
  previousPath?: string; nextPath?: string; onOpen: (path: string) => void | Promise<void>
}) {
  const open = useEventCallback(onOpen)
  useEffect(() => {
    const container = containerRef?.current
    if (!enabled || !container) return
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 2 || !(event.target instanceof Element)) return
      const reader = container.querySelector<HTMLElement>("[data-ails-md-reader]:not([hidden])")
      if (!reader || reader.contains(event.target) || !reader.getClientRects().length) return
      if (event.target.closest("button, input, textarea, select, a, [contenteditable='true'], .monaco-editor, [role='menu'], [role='listbox'], [role='dialog']")) return
      const viewport = container.getBoundingClientRect(), body = reader.getBoundingClientRect()
      const left = viewport.left + container.clientLeft, right = left + container.clientWidth
      // Exclude the header, the scrollbar and anything outside this document pane.
      if (body.width <= 0 || event.clientY < Math.max(viewport.top, body.top) || event.clientY > viewport.bottom
        || event.clientX < left || event.clientX >= right) return
      const path = event.clientX < body.left ? previousPath : event.clientX > body.right ? nextPath : undefined
      if (!path) return
      event.preventDefault()
      event.stopPropagation()
      void open(path)
    }
    container.addEventListener("contextmenu", navigate)
    return () => container.removeEventListener("contextmenu", navigate)
  }, [enabled, documentId, containerRef, previousPath, nextPath, open])
}
