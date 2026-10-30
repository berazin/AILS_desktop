import { useEffect, type RefObject } from "react"
import { copyTextToClipboard } from "../../../shared/clipboard/copy-text.ts"

export function usePdfSelectionCopy(rootRef: RefObject<HTMLElement | null>, text: string, complete: boolean) {
  useEffect(() => {
    if (!complete || !text) return
    const copy = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229
        || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey
        || (event.code !== "KeyC" && event.key.toLowerCase() !== "c")) return
      const root = rootRef.current
      const active = document.activeElement
      if (!root || !root.contains(active) || !root.getClientRects().length) return
      const isInput = (target: EventTarget | null) => target instanceof Element
        && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], .monaco-editor"))
      if (isInput(event.target) || isInput(active)) return
      event.preventDefault()
      event.stopPropagation()
      void copyTextToClipboard(text).catch(error => console.warn("[PDF selection] Copy failed", error))
    }
    window.addEventListener("keydown", copy, true)
    return () => window.removeEventListener("keydown", copy, true)
  }, [complete, rootRef, text])
}
