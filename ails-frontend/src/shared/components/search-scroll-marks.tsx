import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react"
import { useEventCallback } from "../hooks/use-event-callback.ts"

export type SearchScrollMarksHandle = { refresh: () => void }
type Target = Range | HTMLElement

/** Paint ticks over the existing scrollbar without intercepting its drag/wheel. */
export function SearchScrollMarks({ ref, enabled, getContainer, getTargets, activeIndex, revision }: {
  ref?: Ref<SearchScrollMarksHandle>
  enabled: boolean
  getContainer: () => HTMLElement | null
  getTargets: () => readonly Target[]
  activeIndex: number
  revision: string
}) {
  const [layout, setLayout] = useState<{ top: number; left: number; height: number; count: number; marks: { y: number; active: boolean }[] } | null>(null)
  const frame = useRef(0)
  const measure = useEventCallback(() => {
    const container = getContainer()
    if (!enabled || !container || !container.getClientRects().length || container.scrollHeight <= container.clientHeight + 1) { setLayout(null); return }
    const rect = container.getBoundingClientRect(), trackHeight = Math.max(0, container.clientHeight - 28)
    const targets = getTargets(), bins = new Map<number, boolean>()
    targets.forEach((target, index) => {
      if (!(target instanceof HTMLElement) && (target.collapsed || !target.startContainer.isConnected)) return
      const targetRect = target.getBoundingClientRect()
      const y = Math.round(Math.max(0, Math.min(trackHeight - 3, (targetRect.top - rect.top + container.scrollTop) / container.scrollHeight * trackHeight)))
      bins.set(y, Boolean(bins.get(y)) || index === activeIndex)
    })
    setLayout({ top: rect.top + container.clientTop + 14, left: rect.right - Math.max(8, container.offsetWidth - container.clientWidth) + 1,
      height: trackHeight, count: targets.length, marks: Array.from(bins, ([y, active]) => ({ y, active })) })
  })
  const refresh = useEventCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; measure() })
  })
  useImperativeHandle(ref, () => ({ refresh }), [refresh])
  useLayoutEffect(() => {
    if (!enabled) { setLayout(null); return }
    const container = getContainer()
    if (!container) return
    const resize = new ResizeObserver(refresh), mutations = new MutationObserver(refresh)
    resize.observe(container)
    if (container.firstElementChild) resize.observe(container.firstElementChild)
    mutations.observe(container, { childList: true, characterData: true, subtree: true })
    container.addEventListener("scroll", refresh, { passive: true }); container.addEventListener("load", refresh, true)
    window.addEventListener("resize", refresh)
    refresh()
    return () => {
      resize.disconnect(); mutations.disconnect()
      container.removeEventListener("scroll", refresh); container.removeEventListener("load", refresh, true)
      window.removeEventListener("resize", refresh)
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [enabled, getContainer, refresh, revision])
  useLayoutEffect(refresh, [activeIndex, refresh])
  if (!enabled || !layout) return null
  return <svg aria-hidden="true" data-ails-search-scroll-marks data-match-count={layout.count}
    className="pointer-events-none fixed z-[99] overflow-visible" width={7} height={layout.height}
    style={{ top: layout.top, left: layout.left }}>
    {layout.marks.map(mark => <rect key={mark.y} data-active={mark.active} x={0} y={mark.y} width={mark.active ? 7 : 5} height={mark.active ? 3 : 2}
      fill={mark.active ? "var(--brand)" : "#eab308"} />)}
  </svg>
}
