const PROXIMITY = 18
const NEAR = "data-ails-scrollbar-near"
const MANAGED = "data-ails-scrollbar"

/** Monaco owns its scroll model; only its gutter and paint match native panes. */
export const workspaceEditorScrollbar = {
  vertical: "visible" as const,
  horizontal: "visible" as const,
  // Monaco truncates fractional sizes. Its 9px hit area matches Chromium's
  // rounded native gutter; CSS paints the same 8.5px thumb inside it.
  verticalScrollbarSize: 9,
  horizontalScrollbarSize: 9,
  verticalSliderSize: 9,
  horizontalSliderSize: 9,
  useShadows: false,
  alwaysConsumeMouseWheel: false,
}

const controllers = new WeakMap<Document, { references: number; dispose: () => void }>()

/** One delegated listener per renderer, including portals and panes added later. */
export function installWorkspaceScrollbars(doc: Document) {
  const existing = controllers.get(doc)
  if (existing) {
    existing.references++
    return () => release(doc)
  }
  const win = doc.defaultView
  if (!win) return () => {}
  let frame = 0
  let pointer: { x: number; y: number; target: Element | null } | null = null
  let near = new Set<Element>()
  let dragging = new Set<Element>()

  const update = () => {
    frame = 0
    const next = new Set(dragging)
    // Walk only the hovered branch, never every scroll pane on each mouse move.
    for (let node = pointer?.target; node?.isConnected; node = node.parentElement) {
      let paint = node
      let vertical = false, horizontal: boolean, top = false
      if (node.matches(".monaco-scrollable-element")) {
        vertical = Boolean(node.querySelector(":scope > .scrollbar.vertical > .slider")?.clientHeight)
        horizontal = Boolean(node.querySelector(":scope > .scrollbar.horizontal > .slider")?.clientWidth)
      } else if (node.hasAttribute("data-ails-scrollbar-overlay-root")) {
        const track = node.querySelector("[data-ails-scrollbar-overlay]")
        if (!track) continue
        paint = track
        horizontal = true
        top = true
      } else {
        if (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1) continue
        const style = win.getComputedStyle(node)
        vertical = /^(auto|scroll)$/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1
        horizontal = /^(auto|scroll)$/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1
      }
      if (!vertical && !horizontal) continue
      const rect = node.getBoundingClientRect()
      const inside = pointer && rect.width > 0 && rect.height > 0
        && pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom
      const rtl = vertical && win.getComputedStyle(node).direction === "rtl"
      const close = pointer && inside && ((vertical && (rtl ? pointer.x <= rect.left + PROXIMITY : pointer.x >= rect.right - PROXIMITY))
        || (horizontal && (top ? pointer.y <= rect.top + PROXIMITY : pointer.y >= rect.bottom - PROXIMITY)))
      if (!paint.hasAttribute(MANAGED)) paint.setAttribute(MANAGED, "")
      if (close) next.add(paint)
    }
    for (const node of near) if (!next.has(node)) node.removeAttribute(NEAR)
    for (const node of next) if (!near.has(node)) node.setAttribute(NEAR, "")
    near = next
  }
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update) }
  const reset = () => {
    win.cancelAnimationFrame(frame)
    frame = 0
    pointer = null
    for (const node of near) node.removeAttribute(NEAR)
    near.clear()
    dragging.clear()
  }
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") { reset(); return }
    pointer = { x: event.clientX, y: event.clientY, target: event.target instanceof win.Element ? event.target : null }
    schedule()
  }
  const down = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return
    move(event)
    win.cancelAnimationFrame(frame)
    update()
    dragging = new Set(near)
  }
  const up = () => { dragging.clear(); schedule() }
  const leave = () => { if (!dragging.size) reset() }
  doc.addEventListener("pointermove", move, { passive: true, capture: true })
  doc.addEventListener("pointerdown", down, { passive: true, capture: true })
  doc.addEventListener("pointerup", up, { passive: true, capture: true })
  doc.addEventListener("pointercancel", reset, true)
  doc.addEventListener("pointerleave", leave)
  win.addEventListener("blur", reset)
  controllers.set(doc, { references: 1, dispose: () => {
    reset()
    doc.removeEventListener("pointermove", move, true)
    doc.removeEventListener("pointerdown", down, true)
    doc.removeEventListener("pointerup", up, true)
    doc.removeEventListener("pointercancel", reset, true)
    doc.removeEventListener("pointerleave", leave)
    win.removeEventListener("blur", reset)
    for (const node of doc.querySelectorAll(`[${MANAGED}]`)) node.removeAttribute(MANAGED)
  } })
  return () => release(doc)
}

function release(doc: Document) {
  const controller = controllers.get(doc)
  if (controller && --controller.references === 0) {
    controller.dispose()
    controllers.delete(doc)
  }
}
