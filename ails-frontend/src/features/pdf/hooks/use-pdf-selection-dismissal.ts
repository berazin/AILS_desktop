import { useEffect, type RefObject } from "react"

export function usePdfSelectionDismissal(
  rootRef: RefObject<HTMLElement | null>,
  active: boolean,
  clear: () => void,
) {
  useEffect(() => {
    const root = rootRef.current
    if (!active || !root) return
    const viewer = root.closest("[data-ails-pdf-viewer='true']")
      ?? root.closest("[data-pdf-page-spread='true']")
    if (!viewer) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !viewer.contains(target) || root.contains(target)) return
      // Other pages keep their existing selection/annotation gesture handling.
      // This listener owns the viewer's empty margins and chrome.
      if (target.closest("[data-pdf-page-layer='true']")) return
      clear()
    }
    document.addEventListener("pointerdown", dismiss, true)
    return () => document.removeEventListener("pointerdown", dismiss, true)
  }, [active, clear, rootRef])
}
