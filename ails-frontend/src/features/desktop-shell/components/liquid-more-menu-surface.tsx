import { useId, useLayoutEffect, useRef, type RefObject } from "react"
import { GOO_RIM_THRESHOLDS, gooThreshold, squirclePath } from "../vendor/liquid-taffy/core.ts"
import { LiquidGooFilter } from "./liquid-goo-filter.tsx"
import "./liquid-more-menu-surface.css"

type Box = { x: number; y: number; width: number; height: number }
const box = (element: Element): Box => {
  const bounds = element.getBoundingClientRect()
  return { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }
}
const interpolate = (from: Box, to: Box, value: number): Box => ({
  x: from.x + (to.x - from.x) * value, y: from.y + (to.y - from.y) * value,
  width: Math.max(1, from.width + (to.width - from.width) * value), height: Math.max(1, from.height + (to.height - from.height) * value),
})

export function LiquidMoreMenuSurface({ open, view, containerRef, triggerRef }: {
  open: boolean
  view: string | null
  containerRef: RefObject<HTMLDivElement | null>
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const filterId = `ails-more-goo-${useId().replace(/:/g, "")}`
  const surface = useRef<HTMLSpanElement | null>(null)
  const svg = useRef<SVGSVGElement | null>(null)
  const body = useRef<SVGPathElement | null>(null)
  const blur = useRef<SVGFEGaussianBlurElement | null>(null)
  const rim = useRef<SVGFEColorMatrixElement | null>(null)
  const inner = useRef<SVGFEColorMatrixElement | null>(null)
  const current = useRef<Box | null>(null)
  const currentOpacity = useRef(1)
  const lastPanel = useRef<Box | null>(null)

  useLayoutEffect(() => {
    const host = containerRef.current, trigger = triggerRef.current, layer = surface.current
    if (!host || !trigger || !layer) return
    const panel = open ? host.querySelector<HTMLElement>("[data-ails-document-popover]:not([data-liquid-more-surface])") : null
    // Opening uses the final popup box from its first frame. The SVG and DOM
    // share those bounds through the handoff to the unfiltered panel.
    const target = panel ? box(panel) : lastPanel.current ?? box(trigger)
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const icon = trigger.querySelector("svg")
    let frame = 0
    let animating = false
    const clear = () => {
      layer.style.display = "none"
      host.removeAttribute("data-liquid-more-motion")
      panel?.removeAttribute("data-liquid-more-panel")
      panel?.style.removeProperty("--liquid-menu-reveal")
      icon?.style.removeProperty("transform")
    }
    const draw = (shape: Box, reveal: number, filterProgress: number, impact = 0) => {
      const button = box(trigger)
      const left = Math.min(button.x, shape.x, target.x) - 24
      const top = Math.min(button.y, shape.y, target.y) - 24
      const width = Math.max(button.x + button.width, shape.x + shape.width, target.x + target.width) - left + 24
      const height = Math.max(button.y + button.height, shape.y + shape.height, target.y + target.height) - top + 24
      const barBottom = trigger.closest("[data-ails-processbar]")?.getBoundingClientRect().bottom ?? button.y + button.height
      // Keep the popup surface below the process bar, including the final close frame.
      Object.assign(layer.style, { display: "block", left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
        clipPath: `inset(${Math.max(0, barBottom - top)}px 0 0 0)` })
      if (open) currentOpacity.current = reveal
      layer.style.opacity = String(currentOpacity.current)
      svg.current?.setAttribute("viewBox", `0 0 ${width} ${height}`)
      body.current?.setAttribute("d", squirclePath(shape.x - left, shape.y - top, shape.width, shape.height, 11))
      const [outer, inside] = GOO_RIM_THRESHOLDS[5]
      const [finalOuter, finalInside] = GOO_RIM_THRESHOLDS[1]
      blur.current?.setAttribute("stdDeviation", String(5 - 4 * filterProgress))
      rim.current?.setAttribute("values", gooThreshold(outer + (finalOuter - outer) * filterProgress))
      inner.current?.setAttribute("values", gooThreshold(inside + (finalInside - inside) * filterProgress))
      panel?.style.setProperty("--liquid-menu-reveal", String(reveal))
      if (icon) icon.style.transform = `scale(${1 + impact * 0.06}, ${1 - impact * 0.08})`
      current.current = shape
    }
    const settle = () => {
      window.cancelAnimationFrame(frame)
      animating = false
      clear()
      current.current = open && panel ? box(panel) : null
      currentOpacity.current = open && panel ? 1 : 0
      if (panel) lastPanel.current = box(panel)
    }
    const animate = () => {
      if (motion.matches || (open && !panel) || (!open && !current.current)) { settle(); return }
      const button = box(trigger)
      const from = open ? target : current.current ?? button
      if (panel) lastPanel.current = target
      const started = performance.now()
      animating = true
      host.setAttribute("data-liquid-more-motion", open ? "open" : "close")
      panel?.setAttribute("data-liquid-more-panel", "true")
      draw(from, 0, 0)
      const tick = (now: number) => {
        const elapsed = Math.max(0, Math.min(1, (now - started) / (open ? 300 : 180)))
        const destination = open ? target : box(trigger)
        const eased = 1 - (1 - elapsed) ** 3
        draw(interpolate(from, destination, eased), open ? Math.min(1, elapsed / 0.4) : 0, eased, Math.sin(elapsed * Math.PI))
        if (elapsed < 1) frame = window.requestAnimationFrame(tick)
        else settle()
      }
      frame = window.requestAnimationFrame(tick)
    }
    animate()
    const resize = new ResizeObserver(() => { if (!animating) settle() })
    resize.observe(trigger)
    if (panel) resize.observe(panel)
    const stopOnResize = () => settle()
    const reduceMotion = () => { if (motion.matches) settle() }
    window.addEventListener("resize", stopOnResize)
    motion.addEventListener("change", reduceMotion)
    return () => {
      window.cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener("resize", stopOnResize)
      motion.removeEventListener("change", reduceMotion)
      clear()
    }
  }, [containerRef, open, triggerRef, view])

  return <span ref={surface} data-liquid-more-surface data-ails-document-popover aria-hidden="true" style={{ display: "none", position: "fixed", pointerEvents: "none" }}>
    <svg ref={svg} focusable="false" preserveAspectRatio="none">
      <defs><LiquidGooFilter id={filterId} blurRef={blur} rimRef={rim} innerRef={inner} color="var(--border)" /></defs>
      <g filter={`url(#${filterId})`} fill="var(--panel)"><path ref={body} /></g>
    </svg>
  </span>
}
