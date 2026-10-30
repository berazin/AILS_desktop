import { useId, useLayoutEffect, useRef } from "react"
import { GOO_RIM_THRESHOLDS, gooThreshold, sampleHouseSpring, squirclePath } from "../vendor/liquid-taffy/core.ts"
import { LiquidGooFilter } from "./liquid-goo-filter.tsx"
import "./liquid-settings-tab-surface.css"

export function LiquidSettingsTabSurface({ active, detached }: { active: boolean; detached: boolean }) {
  const filterId = `ails-settings-goo-${useId().replace(/:/g, "")}`
  const svg = useRef<SVGSVGElement | null>(null)
  const crisp = useRef<SVGPathElement | null>(null)
  const goo = useRef<SVGGElement | null>(null)
  const body = useRef<SVGPathElement | null>(null)
  const base = useRef<SVGRectElement | null>(null)
  const blur = useRef<SVGFEGaussianBlurElement | null>(null)
  const rim = useRef<SVGFEColorMatrixElement | null>(null)
  const inner = useRef<SVGFEColorMatrixElement | null>(null)
  const progress = useRef(0)

  useLayoutEffect(() => {
    const element = svg.current
    const tab = element?.parentElement?.parentElement
    if (!element || !tab) return
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const target = detached ? 1 : 0
    let frame = 0
    let animating = false
    const draw = (value: number, liquid: boolean) => {
      progress.current = value
      const { width, height } = tab.getBoundingClientRect()
      if (!width || !height) return
      const p = Math.max(0, Math.min(1, value))
      const dropHeight = Math.max(1, height - 1 - value * 4)
      const path = squirclePath(9.5, 0.5, width - 1, dropHeight, 11)
      element.setAttribute("viewBox", `0 0 ${width + 18} ${height}`)
      body.current?.setAttribute("d", path)
      crisp.current?.setAttribute("d", path)
      // Pin the connection to the page and pull its sides inward. Moving a
      // full-width base below the clipped tab leaves an isolated horizontal rim.
      const connection = Math.max(0, 1 - p * 2)
      const baseWidth = (width + 18) * connection
      base.current?.setAttribute("x", String((width + 18 - baseWidth) / 2))
      base.current?.setAttribute("width", String(baseWidth))
      base.current?.setAttribute("y", String(height - 1))
      base.current?.setAttribute("opacity", String(connection))
      // Ease the liquid filter into an identity mask, so neither the corners
      // nor their antialiasing jump when the final unfiltered path takes over.
      const settling = Math.max(0, (p - 0.35) / 0.65)
      const liquidAmount = 1 - settling * settling * (3 - 2 * settling)
      blur.current?.setAttribute("stdDeviation", String(5 * liquidAmount))
      rim.current?.setAttribute("values", gooThreshold(GOO_RIM_THRESHOLDS[5][0] * liquidAmount, 1 + 29 * liquidAmount))
      if (goo.current) goo.current.style.display = liquid ? "" : "none"
      if (crisp.current) crisp.current.style.display = liquid ? "none" : ""
    }
    const finish = () => {
      window.cancelAnimationFrame(frame)
      animating = false
      draw(active ? target : 0, false)
      tab.removeAttribute("data-liquid-tab-motion")
    }
    if (!active) finish()
    else if (motion.matches || Math.abs(progress.current - target) < 0.001) finish()
    else {
      const from = progress.current
      const started = performance.now()
      animating = true
      tab.setAttribute("data-liquid-tab-motion", detached ? "detach" : "attach")
      draw(from, true)
      const tick = (now: number) => {
        const elapsed = Math.min(1, (now - started) / (detached ? 620 : 480))
        draw(from + (target - from) * sampleHouseSpring(elapsed), true)
        if (elapsed < 1) frame = window.requestAnimationFrame(tick)
        else finish()
      }
      frame = window.requestAnimationFrame(tick)
    }
    const resize = new ResizeObserver(() => draw(progress.current, animating))
    resize.observe(tab)
    const reduceMotion = () => { if (motion.matches) finish() }
    motion.addEventListener("change", reduceMotion)
    return () => {
      window.cancelAnimationFrame(frame)
      resize.disconnect()
      motion.removeEventListener("change", reduceMotion)
      tab.removeAttribute("data-liquid-tab-motion")
    }
  }, [active, detached])

  if (!active && !detached) return null
  return <span data-settings-tab-surface aria-hidden="true">
    <svg ref={svg} data-settings-tab-liquid focusable="false" preserveAspectRatio="none">
      <defs>
        <LiquidGooFilter id={filterId} blurRef={blur} rimRef={rim} innerRef={inner} color="var(--processbar-active-background)" borderless />
      </defs>
      <path ref={crisp} data-settings-tab-crisp fill="var(--processbar-active-background)" />
      <g ref={goo} data-settings-tab-goo filter={`url(#${filterId})`} fill="var(--processbar-active-background)">
        <path ref={body} />
        <rect ref={base} height={20} />
      </g>
    </svg>
  </span>
}
