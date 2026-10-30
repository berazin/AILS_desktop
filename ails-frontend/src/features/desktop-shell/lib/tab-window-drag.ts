import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import type { TabTransferPreviewItem, TabGrabPoint } from "../../../shared/workspace-tab-transfer.ts"
import { installTabInsertionPreview } from "./tab-insertion-preview.ts"
import type { installTabReorder } from "./process-bar-tab-reorder.ts"

export function installTabWindowDrag(container: HTMLElement, reorder: ReturnType<typeof installTabReorder>, items: () => TabTransferPreviewItem[]) {
  const api = getAppDesktopApi()
  if (!api?.begin_tab_drag || !api.on_tab_window_event) return () => {}
  const preview = installTabInsertionPreview(container)
  let armed: { pointerId: number; x: number; y: number; anchor: TabGrabPoint } | null = null
  let dragging: { id: string; pointerId: number; ids: string[]; ready: Promise<boolean>; floating: boolean; finishing: boolean } | null = null
  let publishFrame = 0
  let disposed = false
  const publishNow = () => {
    const rect = container.getBoundingClientRect()
    const unit = Array.from(container.children).find((child): child is HTMLElement => child instanceof HTMLElement
      && child.hasAttribute("data-ails-processbar-tab") && !child.hasAttribute("data-tab-transfer-source"))
    const height = unit?.getBoundingClientRect().height || 28
    const tabOrigin = { x: rect.left + container.clientLeft + (parseFloat(getComputedStyle(container).paddingLeft) || 0),
      y: rect.bottom - height }
    void api.register_tab_strip?.({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, tabOrigin }, items())
  }
  const publish = () => {
    if (disposed || publishFrame) return
    publishFrame = window.requestAnimationFrame(() => {
      publishFrame = 0
      if (!disposed) publishNow()
    })
  }
  const stopped = () => {
    const active = dragging
    dragging = null; armed = null
    if (active && container.hasPointerCapture(active.pointerId)) container.releasePointerCapture(active.pointerId)
    for (const element of container.querySelectorAll("[data-tab-transfer-source]")) element.removeAttribute("data-tab-transfer-source")
    document.body.removeAttribute("data-tab-window-dragging")
    preview.clear(); reorder.endNative(true); publish()
  }
  const unsubscribe = api.on_tab_window_event(event => {
    if (event.type === "preview") {
      if (!event.preview || !event.point) { preview.clear(); return }
      preview.update(event.dragId!, event.preview, event.point)
    } else if (event.type === "insertion" && event.requestId && event.point) {
      const beforeId = event.preview ? preview.update(event.dragId!, event.preview, event.point) : preview.beforeId(event.point.x)
      api.reply_tab_window?.(event.requestId, beforeId)
    } else if (event.type === "receive") preview.clear()
    else if (event.type === "drag-position" && dragging && dragging.id === event.dragId && event.point) {
      if (event.floating && !dragging.floating) {
        dragging.floating = true
        // Keep capture on the stable strip before hiding its dragged tab.
        container.setPointerCapture(dragging.pointerId)
        reorder.suspendNative()
        for (const element of Array.from(container.children)) if (element instanceof HTMLElement && element.hasAttribute("data-ails-processbar-tab")) {
          const ids = element.dataset.tabId ? [element.dataset.tabId] : Array.from(element.querySelectorAll<HTMLElement>("[data-tab-id]")).map(tab => tab.dataset.tabId!)
          if (ids.some(id => dragging?.ids.includes(id))) element.setAttribute("data-tab-transfer-source", "")
        }
      } else if (!dragging.floating) reorder.moveNative(event.point.x)
    } else if (event.type === "drag-stopped" && dragging && dragging.id === event.dragId) stopped()
  })
  const finish = async (cancelled: boolean, point?: { x: number; y: number }) => {
    armed = null
    const active = dragging
    if (!active || active.finishing) return
    active.finishing = true
    if (!active.floating) reorder.endNative(cancelled)
    try { if (await active.ready) await api.finish_tab_drag?.(active.id, cancelled, point) }
    catch { /* Closing the source window can reject its pending IPC. */ }
    finally { if (dragging?.id === active.id) stopped() }
  }
  const pointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (event.button !== 0 || event.pointerType !== "mouse" || !event.isPrimary || !target?.closest("[data-tab-id]")
      || target.closest("button, input, [role='button']")) return
    const tab = target.closest<HTMLElement>("[data-tab-id]")!
    const unit = tab.closest<HTMLElement>("[data-split-tab-group]") ?? tab
    const rect = unit.getBoundingClientRect()
    armed = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      anchor: { x: event.clientX - rect.left, y: event.clientY - rect.top } }
  }
  const pointerMove = (event: PointerEvent) => {
    if (!armed || armed.pointerId !== event.pointerId || dragging || Math.hypot(event.clientX - armed.x, event.clientY - armed.y) < 5) return
    const ids = reorder.beginNative()
    if (!ids) { armed = null; return }
    const id = crypto.randomUUID()
    dragging = { id, pointerId: armed.pointerId, ids, floating: false, finishing: false, ready: api.begin_tab_drag!({ id, ids, anchor: armed.anchor }) }
    document.body.setAttribute("data-tab-window-dragging", "")
    event.preventDefault()
  }
  const pointerUp = (event: PointerEvent) => {
    if (armed?.pointerId === event.pointerId) armed = null
    if (dragging?.pointerId === event.pointerId) void finish(false, { x: event.screenX, y: event.screenY })
  }
  const pointerCancel = (event: PointerEvent) => { if (dragging?.pointerId === event.pointerId) void finish(true); else armed = null }
  const lostCapture = (event: PointerEvent) => {
    // Transferring capture from the tab to its strip is intentional.
    if (dragging?.pointerId === event.pointerId && !dragging.finishing && !container.hasPointerCapture(event.pointerId)) void finish(true)
  }
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && dragging) void finish(true) }
  const preventHtmlDrag = (event: DragEvent) => { if ((event.target as Element | null)?.closest?.("[data-tab-id]")) event.preventDefault() }
  const resize = new ResizeObserver(publish)
  resize.observe(container)
  const mutation = new MutationObserver(publish)
  mutation.observe(container, { childList: true })
  container.addEventListener("pointerdown", pointerDown)
  container.addEventListener("lostpointercapture", lostCapture)
  container.addEventListener("dragstart", preventHtmlDrag)
  window.addEventListener("pointermove", pointerMove, { passive: false })
  window.addEventListener("pointerup", pointerUp)
  window.addEventListener("pointercancel", pointerCancel)
  window.addEventListener("keydown", escape)
  window.addEventListener("resize", publish)
  container.addEventListener("ails:tab-layout", publish)
  publish()
  return () => {
    disposed = true
    window.cancelAnimationFrame(publishFrame)
    if (dragging) void finish(true)
    stopped(); unsubscribe(); preview.dispose(); resize.disconnect(); mutation.disconnect()
    container.removeEventListener("pointerdown", pointerDown); container.removeEventListener("lostpointercapture", lostCapture)
    container.removeEventListener("dragstart", preventHtmlDrag)
    window.removeEventListener("pointermove", pointerMove); window.removeEventListener("pointerup", pointerUp)
    window.removeEventListener("pointercancel", pointerCancel); window.removeEventListener("keydown", escape)
    window.removeEventListener("resize", publish); container.removeEventListener("ails:tab-layout", publish)
  }
}
