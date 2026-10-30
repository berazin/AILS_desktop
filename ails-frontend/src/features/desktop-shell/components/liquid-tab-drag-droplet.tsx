import { useEffect, useLayoutEffect, useRef } from "react"
import { applyGooBlur, sampleHouseSpring, squirclePath } from "../vendor/liquid-taffy/core.ts"
import { LiquidGooFilter } from "./liquid-goo-filter.tsx"
import "./liquid-tab-drag-droplet.css"

type DropletMotion = { x: number; y: number; visible: boolean }
type DropletBridge = { onMotion: (callback: (motion: DropletMotion) => void) => () => void }

export function LiquidTabDragDroplet() {
  const body = useRef<SVGPathElement | null>(null)
  const tail = useRef<SVGCircleElement | null>(null)
  const blur = useRef<SVGFEGaussianBlurElement | null>(null)
  const rim = useRef<SVGFEColorMatrixElement | null>(null)
  const inner = useRef<SVGFEColorMatrixElement | null>(null)
  useLayoutEffect(() => {
    document.title = "AILS 탭 이동"
    document.documentElement.setAttribute("data-ails-tab-drag-overlay", "")
    return () => document.documentElement.removeAttribute("data-ails-tab-drag-overlay")
  }, [])
  useEffect(() => {
    const bridge = (window as Window & { ailsTabDragVisual?: DropletBridge }).ailsTabDragVisual
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    let frame = 0, lastTime = 0, appeared = performance.now(), visible = false
    let target = { x: 0, y: 0 }, current = { ...target }
    applyGooBlur({ blur: blur.current, rim: rim.current, inner: inner.current }, 4)
    const draw = (scale: number) => {
      body.current?.setAttribute("d", squirclePath(30 - 14 * scale, 30 - 14 * scale, 28 * scale, 28 * scale, 14))
      tail.current?.setAttribute("cx", String(30 + current.x))
      tail.current?.setAttribute("cy", String(30 + current.y))
      tail.current?.setAttribute("r", String(9 * scale))
    }
    const tick = (now: number) => {
      frame = 0
      const delta = Math.max(0, Math.min(32, now - lastTime)); lastTime = now
      const progress = reduced.matches ? 1 : 1 - Math.exp(-delta / 85)
      current.x += (target.x - current.x) * progress
      current.y += (target.y - current.y) * progress
      target.x *= Math.exp(-delta / 65); target.y *= Math.exp(-delta / 65)
      const elapsed = now - appeared
      draw(reduced.matches ? 1 : 0.8 + 0.2 * sampleHouseSpring(elapsed / 240))
      if (visible && !reduced.matches && (elapsed < 240 || Math.hypot(current.x, current.y) > 0.05)) frame = requestAnimationFrame(tick)
    }
    const unsubscribe = bridge?.onMotion(motion => {
      if (motion.visible && !visible) { appeared = performance.now(); current = { x: 0, y: 0 } }
      visible = motion.visible
      const distance = Math.hypot(motion.x, motion.y)
      const ratio = distance ? Math.min(16, distance * 0.65) / distance : 0
      target = reduced.matches ? { x: 0, y: 0 } : { x: -motion.x * ratio, y: -motion.y * ratio }
      if (!frame) { lastTime = performance.now(); frame = requestAnimationFrame(tick) }
    })
    draw(1)
    return () => { cancelAnimationFrame(frame); unsubscribe?.() }
  }, [])
  return <svg className="ails-liquid-tab-drag-droplet" viewBox="0 0 72 72" aria-label="탭 이동" data-liquid-taffy-droplet>
    <defs><LiquidGooFilter id="ails-tab-drag-goo" blurRef={blur} rimRef={rim} innerRef={inner} color="#c4c8d0" /></defs>
    <g filter="url(#ails-tab-drag-goo)" fill="white"><path ref={body} data-droplet-body /><circle ref={tail} cx="30" cy="30" r="9" /></g>
  </svg>
}
