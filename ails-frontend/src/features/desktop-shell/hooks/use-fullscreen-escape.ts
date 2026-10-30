import { useEffect } from "react"
import { questionTextEntry } from "../../pdf/lib/quick-chat-edit-context-types.ts"

export function useFullscreenEscape(open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat
        || event.isComposing || event.keyCode === 229
        || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      // Open popovers and dialogs consume their own first Escape.
      if (document.querySelector("[data-ails-document-menu-open='true'], [role='dialog'][aria-modal='true'], [data-ails-insight-input='true']")) return
      if (questionTextEntry(event.target) || questionTextEntry(document.activeElement)) return
      if (document.querySelector("[data-ails-document-find]")
        || (event.target instanceof Element && event.target.closest("[data-ails-document-search-input]"))) return
      const renameSelector = "[data-ails-workspace-inline-rename], [data-ails-workspace-rename-session='true']"
      if ((event.target as HTMLElement | null)?.closest?.(renameSelector)
        || document.activeElement?.closest?.(renameSelector)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [open, setOpen])
}
