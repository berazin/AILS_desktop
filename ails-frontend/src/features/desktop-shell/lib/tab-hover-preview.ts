import type { TabScreenCaptureRect, TabScreenPreview } from "../../../shared/tab-screen-preview.ts"
import { createTabScreenPreviewCache } from "./tab-screen-preview-cache.ts"
import { tabHoverPreviewGeometry } from "./tab-hover-preview-geometry.ts"

type Tab = { id: string; title: string }
export type TabHoverPreviewState = { id: string; title: string; image: TabScreenPreview | null; left: number; top: number; width: number; aspect: number }
export type TabHoverPreviewInput = { activeId: string; tabs: Tab[]; groups: readonly (readonly string[])[] }
export const TAB_HOVER_PREVIEW_DELAY = 1000

export function installTabHoverPreview(container: HTMLElement, read: () => TabHoverPreviewInput,
  capture: (rect: TabScreenCaptureRect) => Promise<TabScreenPreview | null>, show: (state: TabHoverPreviewState | null) => void) {
  const cache = createTabScreenPreviewCache()
  let disposed = false, generation = 0, activeKey = "", busy = false, lastCapture = 0
  let candidate: HTMLElement | null = null, visible: HTMLElement | null = null
  let warm = false
  let pointer: { x: number; y: number } | null = null
  let hoverTimer = 0, gapTimer = 0, captureTimer = 0
  const idsFor = (id: string, state = read()) => [...(state.groups.find(group => group.includes(id)) ?? [id])]
  const keyFor = (id: string, state = read()) => JSON.stringify(idsFor(id, state))
  const dragging = () => Boolean(document.body.hasAttribute("data-tab-window-dragging")
    || container.hasAttribute("data-tab-reordering") || container.hasAttribute("data-tab-insertion-preview"))
  const dismissCard = () => {
    clearTimeout(hoverTimer); hoverTimer = 0
    clearTimeout(gapTimer); gapTimer = 0
    candidate = visible = null
    show(null)
  }
  const hide = () => { warm = false; pointer = null; dismissCard() }
  const draw = (tab: HTMLElement) => {
    const state = read(), item = state.tabs.find(item => item.id === tab.dataset.tabId)
    if (!item || !tab.isConnected || !tab.offsetWidth || dragging()) { hide(); return }
    const rect = tab.getBoundingClientRect(), image = cache.get(item.id, keyFor(item.id, state))
    visible = tab; warm = true
    show({ id: item.id, title: item.title, image,
      ...tabHoverPreviewGeometry(rect, { width: window.innerWidth, height: window.innerHeight }) })
  }
  const snapshot = async () => {
    captureTimer = 0
    const state = read()
    if (disposed || busy || visible || document.hidden || dragging() || !state.activeId
      || document.querySelector("[data-tab-window-opening]")) return
    const wait = 350 - (performance.now() - lastCapture)
    if (wait > 0) { schedule(wait); return }
    const version = generation, key = keyFor(state.activeId, state), ids = idsFor(state.activeId, state)
    const top = Math.max(0, Math.ceil(container.getBoundingClientRect().bottom))
    if (top >= window.innerHeight) return
    busy = true; lastCapture = performance.now()
    try {
      const image = await capture({ x: 0, y: top, width: window.innerWidth, height: window.innerHeight - top })
      // Switching away and back is a new generation. Never label a late
      // capture with the previous tab, or cache the popup inside itself.
      if (!disposed && generation === version && !visible && !dragging() && image
        && keyFor(read().activeId) === key) cache.set(ids, key, image)
    } catch { /* A closing window or an older preload can reject capture. */ }
    finally { busy = false }
  }
  const schedule = (delay = 160) => {
    clearTimeout(captureTimer)
    if (!disposed) captureTimer = window.setTimeout(() => { void snapshot() }, delay)
  }
  const arm = (target: HTMLElement) => {
    clearTimeout(hoverTimer); hoverTimer = 0
    clearTimeout(gapTimer); gapTimer = 0
    candidate = target
    // Native captures continue independently; hovering never selects a tab.
    schedule(0)
    if (warm) draw(target)
    else hoverTimer = window.setTimeout(() => { if (candidate === target) draw(target) }, TAB_HOVER_PREVIEW_DELAY)
  }
  const move = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY } }
  const over = (event: PointerEvent) => {
    move(event)
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tab-id]") : null
    if (!target || !container.contains(target) || event.buttons || dragging() || candidate === target) return
    arm(target)
  }
  const out = (event: PointerEvent) => {
    if (!candidate) return
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null
    if (next && candidate.contains(next)) return
    // Keep the warm session through the small gaps between neighboring tabs.
    // Leaving the strip, clicking or dragging starts a fresh one-second wait.
    if (!next || !container.contains(next)) { hide(); return }
    clearTimeout(hoverTimer); hoverTimer = 0
    candidate = null
    // Keep the same popup mounted while crossing a gap so its transform and
    // painted content can transition directly to the next tab.
    clearTimeout(gapTimer)
    gapTimer = window.setTimeout(dismissCard, 140)
  }
  const scroll = (event: Event) => {
    if (event.target instanceof Node && container.contains(event.target)) {
      if (dragging()) { hide(); return }
      const tab = pointer ? document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>("[data-tab-id]") : null
      if (!tab || !container.contains(tab)) dismissCard()
      else if (tab !== candidate) arm(tab)
      else if (visible) draw(visible)
    }
    schedule(180)
  }
  const input = () => schedule(180)
  const resize = () => { generation++; hide(); schedule(100) }
  const blur = () => { generation++; hide() }
  const visibility = () => { generation++; hide(); if (!document.hidden) schedule(100) }
  const own = (node: Node) => node instanceof Element && Boolean(node.closest("[data-tab-hover-preview]"))
  const changes = new MutationObserver(records => {
    if (dragging()) { generation++; hide(); return }
    if (records.some(record => !container.contains(record.target) && !own(record.target)
      && !([...record.addedNodes, ...record.removedNodes].length
        && [...record.addedNodes, ...record.removedNodes].every(own)))) schedule()
  })
  changes.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["src", "aria-busy", "data-tab-window-dragging", "data-tab-reordering", "data-tab-insertion-preview"] })
  container.addEventListener("pointerover", over)
  container.addEventListener("pointermove", move)
  container.addEventListener("pointerout", out)
  container.addEventListener("pointerleave", hide)
  window.addEventListener("pointerdown", hide, true)
  window.addEventListener("keydown", hide, true)
  window.addEventListener("blur", blur)
  window.addEventListener("resize", resize)
  document.addEventListener("scroll", scroll, true)
  document.addEventListener("input", input, true)
  document.addEventListener("load", input, true)
  document.addEventListener("visibilitychange", visibility)
  // Canvas/PDF paint does not always mutate DOM. Sampling is bounded and does
  // not render workspace content, read files, or wake a hidden/minimized app.
  const interval = window.setInterval(() => { void snapshot() }, 1500)
  const sync = () => {
    const state = read(), next = keyFor(state.activeId, state)
    cache.prune(new Map(state.tabs.map(tab => [tab.id, keyFor(tab.id, state)])))
    if (next !== activeKey) { activeKey = next; generation++; hide(); schedule(60) }
    else if (visible) draw(visible)
  }
  sync()
  return {
    sync,
    dispose() {
      disposed = true; generation++; hide(); cache.clear()
      clearTimeout(captureTimer); clearInterval(interval); changes.disconnect()
      container.removeEventListener("pointerover", over); container.removeEventListener("pointerout", out)
      container.removeEventListener("pointermove", move)
      container.removeEventListener("pointerleave", hide)
      window.removeEventListener("pointerdown", hide, true); window.removeEventListener("keydown", hide, true)
      window.removeEventListener("blur", blur); window.removeEventListener("resize", resize)
      document.removeEventListener("scroll", scroll, true); document.removeEventListener("input", input, true)
      document.removeEventListener("load", input, true); document.removeEventListener("visibilitychange", visibility)
    },
  }
}
