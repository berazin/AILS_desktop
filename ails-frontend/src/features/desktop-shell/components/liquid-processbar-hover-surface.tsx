import { useEffect, useId, useRef, type RefObject } from "react"
import { applyGooBlur, sampleHouseSpring, squirclePath } from "../vendor/liquid-taffy/core.ts"
import { LiquidGooFilter } from "./liquid-goo-filter.tsx"
import { PROCESSBAR_REORDER_EVENT } from "../lib/process-bar-tab-reorder.ts"
import "./liquid-processbar-hover-surface.css"

type Point = { x: number; y: number }
const HOVER_TARGETS = "[data-ails-processbar-actions] button, [data-ails-window-controls] button, button[data-ails-processbar-hover-button], [data-tab-id][data-active='false']"

export function LiquidProcessbarHoverSurface({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const filterId = `ails-processbar-hover-${useId().replace(/:/g, "")}`
  const surface = useRef<HTMLSpanElement | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  const body = useRef<SVGPathElement | null>(null)
  const head = useRef<SVGCircleElement | null>(null)
  const tail = useRef<SVGCircleElement | null>(null)
  const blur = useRef<SVGFEGaussianBlurElement | null>(null)
  const outer = useRef<SVGFEColorMatrixElement | null>(null)
  const inner = useRef<SVGFEColorMatrixElement | null>(null)
  const clip = useRef<SVGPathElement | null>(null)

  useEffect(() => {
    const host = containerRef.current, layer = surface.current
    if (!host || !layer) return
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let button: HTMLElement | null = null
    let pressedButton: HTMLElement | null = null
    let pressedTab = false
    let tabViewport: HTMLElement | null = null
    let pressScale = 1, pressTarget = 1
    let target: Point = { x: 0, y: 0 }, current = { ...target }, trailing = { ...target }
    let size = { width: 20, height: 20 }, targetSize = { ...size }
    let frame = 0, lastTime = 0, appearedAt = 0, opacity = 0, lastScale = 1, gapTimer = 0
    let inkButtons = new Set<HTMLElement>()
    const eligible = (element: HTMLElement) => element.matches(HOVER_TARGETS) && !element.matches(":disabled, [aria-disabled='true']")
      && !element.closest("[data-ails-document-popover], [data-ails-voice-error]")
    applyGooBlur({ blur: blur.current, rim: outer.current, inner: inner.current }, 4)

    const draw = (scale: number) => {
      lastScale = scale
      scale *= pressScale
      const bounds = host.getBoundingClientRect()
      svg.current?.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`)
      const rectPath = (left: number, top: number, width: number, height: number) => `M${left} ${top}h${width}v${height}h${-width}Z`
      const viewport = tabViewport?.getBoundingClientRect() ?? bounds
      let clipPath = rectPath(viewport.left - bounds.left, viewport.top - bounds.top, viewport.width, viewport.height)
      // Keep the active tab and static logo clear of the moving surface,
      // including its filtered tail/blur when neighboring buttons are hovered.
      for (const active of host.querySelectorAll<HTMLElement>("[data-ails-processbar-tab][data-active='true'], [data-ails-global-home-button]")) {
        const rect = active.getBoundingClientRect()
        const left = Math.max(viewport.left, rect.left), right = Math.min(viewport.right, rect.right)
        const top = Math.max(viewport.top, rect.top), bottom = Math.min(viewport.bottom, rect.bottom)
        if (right > left && bottom > top) clipPath += rectPath(left - bounds.left, top - bounds.top, right - left, bottom - top)
      }
      clip.current?.setAttribute("d", clipPath)
      body.current?.setAttribute("d", squirclePath(current.x - size.width * scale / 2, current.y - size.height * scale / 2, size.width * scale, size.height * scale, size.height / 2))
      for (const [circle, point, radius] of [[head.current, current, 9], [tail.current, trailing, 6.5]] as const) {
        circle?.setAttribute("cx", String(point.x))
        circle?.setAttribute("cy", String(point.y))
        circle?.setAttribute("r", String(radius * scale))
      }
      layer.style.opacity = String(opacity)
      // Invert only the content under the moving white surface. This keeps
      // partially covered labels readable while the shape crosses buttons.
      const nextInk = new Set<HTMLElement>()
      for (const candidate of host.querySelectorAll<HTMLElement>(HOVER_TARGETS)) {
        if (!eligible(candidate)) continue
        const rect = candidate.getBoundingClientRect()
        if (rect.right - bounds.left > current.x - size.width * scale / 2 - 15
            && rect.left - bounds.left < current.x + size.width * scale / 2 + 15) {
          // Split wrappers form a stacking context. Blend their content as one
          // group so each member's text can see the white surface behind it.
          const ink = candidate.closest<HTMLElement>("[data-split-tab-group]") ?? candidate
          ink.setAttribute("data-liquid-hover-ink", "true")
          nextInk.add(ink)
        }
      }
      for (const previous of inkButtons) if (!nextInk.has(previous)) previous.removeAttribute("data-liquid-hover-ink")
      inkButtons = nextInk
    }
    const clearButton = () => {
      button?.removeAttribute("data-liquid-hover-target")
      button = null
    }
    const hide = () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(gapTimer); gapTimer = 0
      frame = 0
      clearButton()
      pressedButton = null
      pressedTab = false
      tabViewport = null
      pressScale = pressTarget = 1
      opacity = 0
      layer.style.display = "none"
      layer.removeAttribute("data-liquid-hover-motion")
      layer.removeAttribute("data-liquid-hover-pressed")
      for (const previous of inkButtons) previous.removeAttribute("data-liquid-hover-ink")
      inkButtons.clear()
    }
    const tick = (now: number) => {
      frame = 0
      const elapsed = Math.max(0, now - appearedAt)
      const delta = Math.max(0, Math.min(32, now - lastTime))
      lastTime = now
      const follow = 1 - Math.exp(-delta / 42)
      const lag = 1 - Math.exp(-delta / 85)
      current = { x: current.x + (target.x - current.x) * follow, y: current.y + (target.y - current.y) * follow }
      size = { width: size.width + (targetSize.width - size.width) * follow,
        height: size.height + (targetSize.height - size.height) * follow }
      trailing = { x: trailing.x + (current.x - trailing.x) * lag, y: trailing.y + (current.y - trailing.y) * lag }
      // Keep the tail attached during fast pointer moves between buttons.
      const dx = trailing.x - current.x, dy = trailing.y - current.y, distance = Math.hypot(dx, dy)
      if (distance > 15) trailing = { x: current.x + dx * 15 / distance, y: current.y + dy * 15 / distance }
      opacity += ((button ? 1 : 0) - opacity) * (1 - Math.exp(-delta / 55))
      pressScale += (pressTarget - pressScale) * (1 - Math.exp(-delta / 40))
      draw(button ? 0.96 + 0.04 * sampleHouseSpring(elapsed / 220) : 1)
      if (!button && opacity < 0.01) { hide(); return }
      if (!button || elapsed < 220 || Math.hypot(target.x - current.x, target.y - current.y) > 0.05
          || Math.abs(targetSize.width - size.width) > 0.05 || Math.abs(targetSize.height - size.height) > 0.05
          || Math.hypot(current.x - trailing.x, current.y - trailing.y) > 0.05 || opacity < 0.995
          || Math.abs(pressTarget - pressScale) > 0.001) {
        frame = window.requestAnimationFrame(tick)
      }
    }
    const animate = () => {
      if (frame) return
      lastTime = performance.now()
      frame = window.requestAnimationFrame(tick)
    }
    const leave = () => {
      window.clearTimeout(gapTimer); gapTimer = 0
      clearButton()
      pressTarget = 1
      layer.removeAttribute("data-liquid-hover-pressed")
      if (motion.matches) hide()
      else if (opacity > 0) { layer.setAttribute("data-liquid-hover-motion", "leave"); animate() }
      else hide()
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      const element = event.target instanceof Element ? event.target : null
      const dragged = host.querySelector<HTMLElement>("[data-tab-dragged]")
      const captured = pressedButton && (dragged?.contains(pressedButton) || pressedTab && (event.buttons & 1) !== 0) ? pressedButton : null
      if (dragged?.dataset.active === "true" || (!captured && element?.closest("[data-tab-id][data-active='true']"))) { hide(); return }
      const next = captured ?? element?.closest<HTMLElement>(HOVER_TARGETS) ?? null
      const strip = next?.hasAttribute("data-tab-id") ? next.closest<HTMLElement>("[data-ails-processbar-tab-strip]") : null
      const stripBounds = strip?.getBoundingClientRect()
      if (stripBounds && (event.clientX < stripBounds.left || event.clientX >= stripBounds.right
        || event.clientY < stripBounds.top || event.clientY >= stripBounds.bottom)) { leave(); return }
      if (!next || !eligible(next)) {
        const bounds = host.getBoundingClientRect()
        const actionsLeft = host.querySelector("[data-ails-processbar-actions]")?.getBoundingClientRect().left ?? bounds.right
        const group = button?.closest("[data-ails-processbar-hover-group]")?.getBoundingClientRect()
        const withinButtonGap = !next && (event.clientX >= actionsLeft || (group && event.clientX >= group.left && event.clientX <= group.right))
          && event.clientY >= bounds.top && event.clientY < bounds.bottom
          && !element?.closest("[data-ails-document-popover], [data-ails-voice-error]")
        if (withinButtonGap && button && !motion.matches) {
          if (!gapTimer) gapTimer = window.setTimeout(leave, 120)
        } else leave()
        return
      }
      window.clearTimeout(gapTimer); gapTimer = 0
      const bounds = host.getBoundingClientRect(), rect = next.getBoundingClientRect()
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      target = { x: center.x - bounds.left + Math.max(-3, Math.min(3, event.clientX - center.x)),
        y: center.y - bounds.top }
      if (button !== next) {
        clearButton()
        button = next
        tabViewport = strip
        button.setAttribute("data-liquid-hover-target", "true")
        targetSize = { width: Math.max(18, rect.width - 2),
          height: Math.min(next.dataset.ailsProcessbarHoverButton === "new-tab" ? 20 : 24, rect.height) }
        if (layer.style.display === "none") {
          size = { ...targetSize }
          current = { x: center.x - bounds.left, y: center.y - bounds.top }
          trailing = { ...current }; appearedAt = performance.now(); opacity = 1
          draw(0.96)
        } else draw(lastScale)
      }
      layer.style.display = "block"
      layer.setAttribute("data-liquid-hover-motion", "follow")
      pressTarget = pressedButton === button ? 0.9 : 1
      layer.toggleAttribute("data-liquid-hover-pressed", pressTarget < 1)
      if (motion.matches) { size = { ...targetSize }; current = { ...target }; trailing = { ...target }; opacity = 1; pressScale = pressTarget; draw(1) }
      else animate()
    }
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === "touch") return
      const next = event.target instanceof Element ? event.target.closest<HTMLElement>(HOVER_TARGETS) : null
      if (!next || !eligible(next)) return
      pressedButton = next
      pressedTab = next.hasAttribute("data-tab-id") && !(event.target instanceof Element && event.target.closest("button"))
      move(event)
    }
    const release = () => {
      if (!pressedButton) return
      pressedButton = null
      pressedTab = false
      pressTarget = 1
      layer.removeAttribute("data-liquid-hover-pressed")
      if (motion.matches) { pressScale = 1; draw(lastScale) }
      else if (layer.style.display !== "none") animate()
    }
    const reduceMotion = () => {
      if (!motion.matches) return
      if (gapTimer) { leave(); return }
      window.cancelAnimationFrame(frame); frame = 0
      if (button) { size = { ...targetSize }; current = { ...target }; trailing = { ...target }; opacity = 1; pressScale = pressTarget; draw(1) }
      else hide()
    }
    const resize = new ResizeObserver(hide)
    resize.observe(host)
    const followReorder = () => {
      if (!button || !tabViewport?.hasAttribute("data-tab-reordering") || !button.closest("[data-tab-dragged]")) return
      if (!eligible(button)) { hide(); return }
      const bounds = host.getBoundingClientRect(), rect = button.getBoundingClientRect()
      target = { x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top + rect.height / 2 }
      current = { ...target }
      const distance = Math.hypot(trailing.x - current.x, trailing.y - current.y)
      if (distance > 15) trailing = { x: current.x + (trailing.x - current.x) * 15 / distance, y: current.y + (trailing.y - current.y) * 15 / distance }
      opacity = 1
      draw(lastScale)
      if (!motion.matches) animate()
    }
    const scroll = () => {
      if (button?.closest("[data-tab-dragged]")) return
      hide()
    }
    const changes = new MutationObserver(() => {
      if (host.querySelector("[data-tab-dragged][data-active='true']")
        || button && (!host.contains(button) || !eligible(button))) hide()
      else if (layer.style.display !== "none") draw(lastScale)
    })
    changes.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "data-active", "data-tab-reordering"] })
    host.addEventListener("pointermove", move)
    host.addEventListener("pointerdown", press)
    host.addEventListener("pointerleave", leave)
    host.addEventListener("scroll", scroll, true)
    host.addEventListener(PROCESSBAR_REORDER_EVENT, followReorder, true)
    window.addEventListener("pointerup", release, true)
    window.addEventListener("pointercancel", release, true)
    window.addEventListener("blur", hide)
    motion.addEventListener("change", reduceMotion)
    hide()
    return () => {
      hide(); resize.disconnect(); changes.disconnect()
      host.removeEventListener("pointermove", move)
      host.removeEventListener("pointerdown", press)
      host.removeEventListener("pointerleave", leave)
      host.removeEventListener("scroll", scroll, true)
      host.removeEventListener(PROCESSBAR_REORDER_EVENT, followReorder, true)
      window.removeEventListener("pointerup", release, true)
      window.removeEventListener("pointercancel", release, true)
      window.removeEventListener("blur", hide)
      motion.removeEventListener("change", reduceMotion)
    }
  }, [containerRef])

  return <span ref={surface} data-liquid-processbar-hover aria-hidden="true">
    <svg ref={svg} focusable="false" preserveAspectRatio="none">
      <defs><LiquidGooFilter id={filterId} blurRef={blur} rimRef={outer} innerRef={inner} color="#ffffff" borderless />
        <mask id={`${filterId}-clip`} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" style={{ maskType: "alpha" }}>
          <path ref={clip} data-liquid-hover-clip fill="#ffffff" fillRule="evenodd" />
        </mask>
      </defs>
      <g filter={`url(#${filterId})`} mask={`url(#${filterId}-clip)`} fill="#ffffff">
        <path ref={body} data-liquid-hover-body />
        <circle ref={head} data-liquid-hover-head />
        <circle ref={tail} data-liquid-hover-tail />
      </g>
    </svg>
  </span>
}
