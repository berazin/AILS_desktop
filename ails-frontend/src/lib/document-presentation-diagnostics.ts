import { getAppDesktopApi } from './desktop-api.ts'
import { initialDocumentReadiness } from './initial-document-readiness.ts'

export function markDocumentStartupPhase(name: string) {
  if (getAppDesktopApi()?.startup_diagnostics_enabled) performance.mark(`ails:${name}`)
}

/** Release optional preparation after presentation; diagnostics are opt-in. */
export function observeDocumentPresentation(kind: string, getElement: () => Element | null | undefined) {
  const api = getAppDesktopApi()
  const diagnostics = api?.startup_diagnostics_enabled && api.report_document_presented
  if (!initialDocumentReadiness.waiting && !diagnostics) return
  let stopped = false, frame = 0
  const check = async () => {
    if (stopped) return
    const element = getElement(), rect = element?.getBoundingClientRect()
    const left = Math.max(0, rect?.left ?? 0), right = Math.min(window.innerWidth, rect?.right ?? 0)
    const top = Math.max(0, rect?.top ?? 0), bottom = Math.min(window.innerHeight, rect?.bottom ?? 0)
    const visible = right > left && bottom > top
      && element?.contains(document.elementFromPoint((left + right) / 2, (top + bottom) / 2))
    if (visible) {
      initialDocumentReadiness.finish()
      if (!diagnostics) return
      try { if (await diagnostics(kind)) return } catch { return }
    }
    if (!stopped) frame = requestAnimationFrame(() => { void check() })
  }
  frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { void check() }) })
  return () => { stopped = true; cancelAnimationFrame(frame) }
}
