import { tabTravelProgress, type TabSelectionGeometry } from "./process-bar-selection-motion.ts"

export const PROCESSBAR_REORDER_EVENT = "ails:processbar-reorder-frame"
export type ReorderSelection = TabSelectionGeometry & { id: string }

type Unit = {
  element: HTMLElement
  ids: string[]
  base: number
  width: number
  height: number
  x: number
  from: number
  target: number
  started: number
  transform: string
  painted?: number
}
type Session = {
  units: Unit[]
  order: Unit[]
  dragged: Unit
  capture: HTMLElement
  selected?: Unit
  pointerId: number
  startX: number
  pointerX: number
  startScroll: number
  left: number
  right: number
  gap: number
  first: number
  last: number
  phase: "armed" | "dragging" | "settling"
  native?: boolean
  previousFrame: number
  previousCursor: string
}

// All movement stays in the tab strip. React receives one ordered ID list on
// drop, so PDF/editor/Home content does not render for each pointer movement.
export function installTabReorder(container: HTMLElement, commit: (ids: string[]) => void) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
  let session: Session | null = null
  let frame = 0
  let suppressClick = false

  const notify = (selection: ReorderSelection | null) => {
    container.dispatchEvent(new CustomEvent(PROCESSBAR_REORDER_EVENT, { detail: selection }))
  }
  const release = (drag: Session) => {
    if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId)
    document.body.style.cursor = drag.previousCursor
  }
  const clear = () => {
    window.cancelAnimationFrame(frame)
    frame = 0
    const drag = session
    session = null
    if (drag) {
      if (drag.phase !== "armed") suppressClick = true
      release(drag)
      for (const unit of drag.units) {
        unit.element.style.transform = unit.transform
        unit.element.removeAttribute("data-tab-dragged")
      }
    }
    container.removeAttribute("data-tab-reordering")
    notify(null)
  }
  const retarget = (unit: Unit, target: number, now: number) => {
    if (Math.abs(unit.target - target) < 0.01) return
    unit.from = unit.x
    unit.target = target
    unit.started = now
  }
  const layout = (drag: Session, now: number) => {
    let x = drag.first
    for (const unit of drag.order) {
      retarget(unit, x, now)
      x += unit.width + drag.gap
    }
  }
  const sample = (unit: Unit, now: number) => {
    const progress = reducedMotion.matches ? 1 : tabTravelProgress(now - unit.started)
    unit.x = unit.from + (unit.target - unit.from) * progress
    return progress === 1 || Math.abs(unit.x - unit.target) < 0.01
  }
  const paint = (now: number) => {
    frame = 0
    const drag = session
    if (!drag || drag.phase === "armed") return
    let moving = false
    // Read scroll once before transform writes; tab dimensions were cached at
    // pointer-down, so there is no per-frame layout measurement.
    if (drag.phase === "dragging") {
      const elapsed = Math.min(32, Math.max(0, now - drag.previousFrame))
      const edge = Math.min(40, (drag.right - drag.left) / 4)
      const proximity = drag.pointerX < drag.left + edge ? -Math.min(1, (drag.left + edge - drag.pointerX) / edge)
        : drag.pointerX > drag.right - edge ? Math.min(1, (drag.pointerX - drag.right + edge) / edge) : 0
      if (proximity) container.scrollLeft += proximity * elapsed * 0.65
      drag.dragged.x = Math.max(drag.first, Math.min(drag.last - drag.dragged.width,
        drag.dragged.base + drag.pointerX - drag.startX + container.scrollLeft - drag.startScroll))
      let index = drag.order.indexOf(drag.dragged)
      // Cross the adjacent tab's midpoint. Unequal widths and split pairs keep
      // their own slots, with interrupted peers continuing from painted x.
      while (index < drag.order.length - 1 && drag.dragged.x + drag.dragged.width > drag.order[index + 1].target + drag.order[index + 1].width / 2) {
        const next = drag.order[index + 1]
        drag.order.splice(index, 2, next, drag.dragged)
        index++
        layout(drag, now)
      }
      while (index > 0 && drag.dragged.x < drag.order[index - 1].target + drag.order[index - 1].width / 2) {
        const previous = drag.order[index - 1]
        drag.order.splice(index - 1, 2, drag.dragged, previous)
        index--
        layout(drag, now)
      }
    }
    drag.previousFrame = now
    for (const unit of drag.units) {
      if (unit !== drag.dragged || drag.phase === "settling") moving = !sample(unit, now) || moving
      const offset = unit.x - unit.base
      if (unit.painted !== offset) {
        unit.element.style.transform = `translate3d(${offset}px, 0, 0)`
        unit.painted = offset
      }
    }
    if (drag.selected) {
      const unit = drag.selected
      notify({ id: unit.ids.length > 1 ? `split:${unit.ids.join(":")}` : unit.ids[0], x: unit.x,
        width: unit.width, height: unit.height, detached: unit.element.dataset.tabDetached === "true" ? 1 : 0, stretch: 0 })
    }
    if (drag.phase === "settling" && !moving) clear()
    else frame = window.requestAnimationFrame(paint)
  }
  const settle = (cancel: boolean) => {
    const drag = session
    if (!drag) return
    if (drag.phase === "armed") { clear(); return }
    if (drag.phase !== "dragging") return
    window.cancelAnimationFrame(frame)
    // Flush the final pointer position before committing, even between frames.
    paint(performance.now())
    window.cancelAnimationFrame(frame)
    drag.phase = "settling"
    release(drag)
    suppressClick = true
    if (cancel) drag.order = [...drag.units]
    const now = performance.now()
    layout(drag, now)
    drag.dragged.from = drag.dragged.x
    drag.dragged.started = now
    frame = window.requestAnimationFrame(paint)
    if (!cancel && drag.order.some((unit, index) => unit !== drag.units[index])) commit(drag.order.flatMap(unit => unit.ids))
  }
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType !== "mouse" || !event.isPrimary) return
    suppressClick = false
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest("button, input, [role='button']")) return
    const tab = target.closest<HTMLElement>("[data-tab-id]")
    const element = tab?.closest<HTMLElement>("[data-split-tab-group]") ?? tab
    if (!element || element.parentElement !== container) return
    clear()
    suppressClick = false
    const bounds = container.getBoundingClientRect()
    const units = Array.from(container.children).filter((child): child is HTMLElement => child instanceof HTMLElement
      && child.hasAttribute("data-ails-processbar-tab")).map((child): Unit => {
      const rect = child.getBoundingClientRect()
      const x = rect.left - bounds.left + container.scrollLeft - container.clientLeft
      return { element: child, ids: child.dataset.tabId ? [child.dataset.tabId]
        : Array.from(child.querySelectorAll<HTMLElement>("[data-tab-id]")).map(item => item.dataset.tabId!),
        base: x, width: rect.width, height: rect.height, x, from: x, target: x, started: 0, transform: child.style.transform }
    })
    const dragged = units.find(unit => unit.element === element)
    if (!dragged) return
    session = { units, order: [...units], dragged, capture: tab!, selected: units.find(unit => unit.element.matches('[aria-selected="true"]')
      || unit.element.querySelector('[aria-selected="true"]')), pointerId: event.pointerId,
      startX: event.clientX, pointerX: event.clientX, startScroll: container.scrollLeft,
      left: bounds.left, right: bounds.right, gap: units[1] ? units[1].base - units[0].base - units[0].width : 4,
      first: units[0].base, last: units.at(-1)!.base + units.at(-1)!.width,
      phase: "armed", previousFrame: performance.now(), previousCursor: document.body.style.cursor }
    // Capture the clicked member, rather than its split wrapper, so ordinary
    // clicks still reach that member's selection handler.
    tab!.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: PointerEvent) => {
    const drag = session
    if (!drag || drag.pointerId !== event.pointerId || drag.phase === "settling") return
    drag.pointerX = event.clientX
    if (drag.phase === "armed") {
      if (Math.abs(event.clientX - drag.startX) < 5) return
      drag.phase = "dragging"
      container.setAttribute("data-tab-reordering", "")
      drag.dragged.element.setAttribute("data-tab-dragged", "")
      document.body.style.cursor = "grabbing"
      frame = window.requestAnimationFrame(paint)
    }
    event.preventDefault()
  }
  const pointerUp = (event: PointerEvent) => {
    if (session?.pointerId !== event.pointerId) return
    if (session.native) return
    session.pointerX = event.clientX
    settle(false)
  }
  const pointerCancel = (event: PointerEvent) => { if (session?.pointerId === event.pointerId && !session.native) settle(true) }
  const lostCapture = (event: PointerEvent) => { if (session?.pointerId === event.pointerId && !session.native && session.phase !== "settling") settle(true) }
  const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && session && !session.native) { event.preventDefault(); settle(true) } }
  const blur = () => { if (!session?.native) settle(true) }
  const click = (event: MouseEvent) => {
    if (!suppressClick || event.detail === 0) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  container.addEventListener("pointerdown", pointerDown)
  container.addEventListener("click", click, true)
  container.addEventListener("lostpointercapture", lostCapture)
  window.addEventListener("pointermove", pointerMove, { passive: false })
  window.addEventListener("pointerup", pointerUp)
  window.addEventListener("pointercancel", pointerCancel)
  window.addEventListener("keydown", keyDown)
  window.addEventListener("blur", blur)
  window.addEventListener("resize", blur)
  return {
    beginNative: () => {
      if (!session) return null
      session.native = true
      session.phase = "dragging"
      container.setAttribute("data-tab-reordering", "")
      session.dragged.element.setAttribute("data-tab-dragged", "")
      if (!frame) frame = window.requestAnimationFrame(paint)
      return [...session.dragged.ids]
    },
    moveNative: (x: number) => { if (session?.native) session.pointerX = x },
    endNative: (cancel = false) => { if (session?.native) settle(cancel) },
    suspendNative: () => { if (session?.native) clear() },
    syncLayout: () => {
      const drag = session
      if (!drag) return
      if (drag.phase !== "settling") { clear(); return }
      const actual = Array.from(container.children).filter(child => child.hasAttribute("data-ails-processbar-tab"))
      if (actual.length !== drag.order.length || actual.some((child, index) => child !== drag.order[index].element)) { clear(); return }
      const bounds = container.getBoundingClientRect()
      // React has committed the new order. Rebase existing transforms before
      // paint to keep every tab at its previous visual position (FLIP).
      for (const unit of drag.units) {
        const rect = unit.element.getBoundingClientRect()
        const base = rect.left - bounds.left + container.scrollLeft - container.clientLeft - (unit.x - unit.base)
        unit.base = base
        unit.element.style.transform = `translate3d(${unit.x - base}px, 0, 0)`
        unit.painted = unit.x - base
      }
    },
    dispose: () => {
      clear()
      container.removeEventListener("pointerdown", pointerDown)
      container.removeEventListener("click", click, true)
      container.removeEventListener("lostpointercapture", lostCapture)
      window.removeEventListener("pointermove", pointerMove)
      window.removeEventListener("pointerup", pointerUp)
      window.removeEventListener("pointercancel", pointerCancel)
      window.removeEventListener("keydown", keyDown)
      window.removeEventListener("blur", blur)
      window.removeEventListener("resize", blur)
    },
  }
}
