import { useLayoutEffect, type RefObject } from "react"

import type { ViewerDocument } from "../../../lib/viewer-document.ts"

// Renderer memory only: closing/replacing a tab retains the position, quitting
// the application discards it. Use file identity rather than a transient tab ID.
const positions = new Map<string, { top: number; left: number }>()

export function useDocumentScrollRestoration(
  document: ViewerDocument | null,
  scrollRef: RefObject<HTMLElement | null>,
  active = true,
) {
  const key = document?.file_path
    ? document.file_path.replace(/\\/g, "/").toLowerCase()
    : document?.id ?? ""
  const loading = Boolean(document?.loading)

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!active || loading || !key || !container) return
    const saved = positions.get(key) ?? { top: 0, left: 0 }
    let restoring = true

    const remember = () => {
      if (!restoring) positions.set(key, { top: container.scrollTop, left: container.scrollLeft })
    }
    const restore = () => {
      if (!restoring) return
      container.scrollTop = saved.top
      container.scrollLeft = saved.left
      // Images/preview content may not have their final height yet. Retry on
      // layout growth without replacing the remembered offset with a clamp.
      if (Math.abs(container.scrollTop - saved.top) < 1 && Math.abs(container.scrollLeft - saved.left) < 1) {
        restoring = false
        remember()
      }
    }
    const takeControl = () => {
      restoring = false
      remember()
    }
    const resize = new ResizeObserver(restore)
    resize.observe(container)
    if (container.firstElementChild) resize.observe(container.firstElementChild)
    container.addEventListener("load", restore, true)
    container.addEventListener("scroll", remember, { passive: true })
    container.addEventListener("wheel", takeControl, { passive: true })
    container.addEventListener("pointerdown", takeControl, true)
    // Save before a tab click or keyboard navigation can replace the DOM.
    // Navigating away while content is still loading must retain the original
    // target rather than the temporary clamped position.
    window.addEventListener("pointerdown", remember, true)
    window.addEventListener("keydown", remember, true)
    restore()
    return () => {
      resize.disconnect()
      container.removeEventListener("load", restore, true)
      container.removeEventListener("scroll", remember)
      container.removeEventListener("wheel", takeControl)
      container.removeEventListener("pointerdown", takeControl, true)
      window.removeEventListener("pointerdown", remember, true)
      window.removeEventListener("keydown", remember, true)
    }
  }, [active, key, loading, scrollRef])
}
