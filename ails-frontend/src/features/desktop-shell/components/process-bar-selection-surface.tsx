import { useLayoutEffect, useRef, type RefObject } from "react"
import { sampleTabSelection, tabSelectionPath, TAB_SELECTION_DURATION, TAB_SELECTION_FLARE, type TabSelectionGeometry } from "../lib/process-bar-selection-motion.ts"
import { PROCESSBAR_REORDER_EVENT, type ReorderSelection } from "../lib/process-bar-tab-reorder.ts"
import "./process-bar-selection-surface.css"

type Selection = TabSelectionGeometry & { id: string }
type Controller = { select: () => void }

export function ProcessBarSelectionSurface({ containerRef, selectionKey, layoutKey, onSettled }: {
  containerRef: RefObject<HTMLDivElement | null>
  selectionKey: string
  layoutKey: string
  onSettled?: () => void
}) {
  const surfaceRef = useRef<HTMLSpanElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const controllerRef = useRef<Controller | null>(null)

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    // Child layout effects can run before React attaches the parent's ref.
    const container = containerRef.current ?? surface?.parentElement
    const svg = svgRef.current
    const path = pathRef.current
    if (!container || !surface || !svg || !path) return

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let current: TabSelectionGeometry | null = null
    let destination: Selection | null = null
    let frame = 0
    let layoutFrame = 0
    let pendingAnimation = false
    let pendingForce = false
    let paintedDpr = 0
    const stop = () => {
      window.cancelAnimationFrame(frame)
      frame = 0
      surface.removeAttribute("data-moving")
    }
    const measure = (): Selection | null => {
      const selected = container.querySelector<HTMLElement>('[data-tab-id][aria-selected="true"]')
      const tab = selected?.closest<HTMLElement>("[data-split-tab-group]") ?? selected
      if (!tab) return null
      const bounds = tab.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return null
      const parent = container.getBoundingClientRect()
      return {
        id: tab.dataset.tabId ?? `split:${Array.from(tab.querySelectorAll<HTMLElement>("[data-tab-id]")).map(item => item.dataset.tabId).join(":")}`,
        x: bounds.left - parent.left + container.scrollLeft - container.clientLeft,
        width: bounds.width,
        height: bounds.height,
        detached: tab.dataset.tabDetached === "true" ? 1 : 0,
        stretch: 0,
      }
    }
    const draw = (geometry: TabSelectionGeometry) => {
      const dpr = window.devicePixelRatio || 1
      const reshape = !current || current.width !== geometry.width || current.height !== geometry.height || current.detached !== geometry.detached || paintedDpr !== dpr
      current = geometry
      paintedDpr = dpr
      surface.style.transform = `translate3d(${geometry.x - TAB_SELECTION_FLARE}px, 0, 0)`
      if (reshape) {
        surface.style.width = `${geometry.width + TAB_SELECTION_FLARE * 2}px`
        surface.style.height = `${geometry.height}px`
        svg.setAttribute("viewBox", `0 0 ${geometry.width + TAB_SELECTION_FLARE * 2} ${geometry.height}`)
        path.setAttribute("d", tabSelectionPath(geometry.width, geometry.height, geometry.detached, 1 / dpr))
      }
      surface.dataset.detached = String(geometry.detached)
      surface.hidden = false
      container.setAttribute("data-processbar-selection-ready", "")
    }
    const update = (animate: boolean, force = false) => {
      if (container.hasAttribute("data-tab-reordering")) return
      const next = measure()
      if (!next) {
        stop()
        current = destination = null
        surface.hidden = true
        container.removeAttribute("data-processbar-selection-ready")
        onSettled?.()
        return
      }
      if (!force && destination && destination.id === next.id && destination.detached === next.detached
        && Math.abs(destination.x - next.x) < 0.1 && Math.abs(destination.width - next.width) < 0.1
        && Math.abs(destination.height - next.height) < 0.1) return

      const changedSelection = destination?.id !== next.id || destination?.detached !== next.detached
      // Keep the last painted geometry when interrupted; never jump back to
      // the old tab or let two clocks write to the same surface.
      stop()
      destination = next
      if (!current || motion.matches || !animate || !changedSelection) {
        draw(next)
        onSettled?.()
        return
      }
      const from = current
      const started = performance.now()
      surface.setAttribute("data-moving", "")
      const tick = (now: number) => {
        const elapsed = now - started
        if (elapsed >= TAB_SELECTION_DURATION) {
          draw(next)
          stop()
          onSettled?.()
          return
        }
        draw(sampleTabSelection(from, next, elapsed))
        frame = window.requestAnimationFrame(tick)
      }
      frame = window.requestAnimationFrame(tick)
    }
    // Coalesce React commits, resize and title changes before measuring. A
    // synchronous layout read after every source forces the whole workspace
    // to lay out repeatedly while the initial document is still mounting.
    const scheduleUpdate = (animate: boolean, force = false) => {
      pendingAnimation ||= animate
      pendingForce ||= force
      if (layoutFrame) return
      layoutFrame = window.requestAnimationFrame(() => {
        layoutFrame = 0
        const animate = pendingAnimation, force = pendingForce
        pendingAnimation = pendingForce = false
        update(animate, force)
      })
    }
    controllerRef.current = { select: () => scheduleUpdate(true) }
    scheduleUpdate(false)

    const followReorder = (event: Event) => {
      const next = (event as CustomEvent<ReorderSelection | null>).detail
      if (!next) {
        if (!measure()) { stop(); current = destination = null; surface.hidden = true }
        else update(false)
        return
      }
      stop()
      destination = next
      draw(next)
    }
    container.addEventListener(PROCESSBAR_REORDER_EVENT, followReorder)

    const resize = new ResizeObserver(() => scheduleUpdate(false))
    const observeTabs = () => {
      resize.disconnect()
      resize.observe(container)
      for (const child of Array.from(container.children)) {
        if (child !== surface) resize.observe(child)
      }
    }
    observeTabs()
    const mutations = new MutationObserver(records => {
      // Existing observed tabs report size changes themselves. Re-observing
      // every descendant text update produces redundant initial resize events.
      if (records.some(record => record.type === "childList" && record.target === container)) observeTabs()
      scheduleUpdate(false)
    })
    mutations.observe(container, { childList: true, subtree: true, characterData: true })
    const reducedMotion = () => {
      if (motion.matches && destination) { stop(); draw(destination); onSettled?.() }
    }
    motion.addEventListener("change", reducedMotion)
    // A monitor move can change DPR without changing the CSS tab dimensions.
    // Re-arm the one-shot resolution query at each actual scale change.
    let resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    const displayScaleChanged = () => {
      resolution.removeEventListener("change", displayScaleChanged)
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      resolution.addEventListener("change", displayScaleChanged)
      scheduleUpdate(false, true)
    }
    resolution.addEventListener("change", displayScaleChanged)
    return () => {
      stop()
      window.cancelAnimationFrame(layoutFrame)
      resize.disconnect()
      mutations.disconnect()
      motion.removeEventListener("change", reducedMotion)
      resolution.removeEventListener("change", displayScaleChanged)
      container.removeEventListener(PROCESSBAR_REORDER_EVENT, followReorder)
      container.removeAttribute("data-processbar-selection-ready")
      controllerRef.current = null
    }
  }, [containerRef, onSettled])

  useLayoutEffect(() => { controllerRef.current?.select() }, [selectionKey, layoutKey])

  return <span ref={surfaceRef} data-processbar-selection-surface aria-hidden="true" hidden>
    <svg ref={svgRef} preserveAspectRatio="none" focusable="false">
      <path ref={pathRef} />
    </svg>
  </span>
}
