import { useLayoutEffect, useState, type RefObject } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

export const HOME_MATERIAL_ROW_HEIGHT = 41
export const HOME_MATERIAL_CARD_HEIGHT = 332
const OVERSCAN = 8
const WINDOW_THRESHOLD = 80

export function materialWindow(count: number, offset: number, viewport: number, rowHeight = HOME_MATERIAL_ROW_HEIGHT, overscan = OVERSCAN) {
  const start = Math.max(0, Math.min(count, Math.floor(offset / rowHeight) - overscan))
  const end = Math.min(count, Math.max(start, Math.ceil((offset + viewport) / rowHeight) + overscan))
  return { start, end }
}

// Keep the full scroll height while limiting restored table DOM to visible rows.
function useMaterialWindow(count: number, scrollRef: RefObject<HTMLDivElement | null>, bodyRef: RefObject<HTMLElement | null>, enabled: boolean, folderPath: string, grid: boolean) {
  const [range, setRange] = useState({ start: 0, end: 32, columns: 1, gap: 0 })
  const windowed = enabled && count > WINDOW_THRESHOLD

  useLayoutEffect(() => {
    if (!windowed) return
    const scroll = scrollRef.current
    const body = bodyRef.current
    if (!scroll || !body) return
    let frame = 0
    const update = () => {
      const offset = scroll.getBoundingClientRect().top - body.getBoundingClientRect().top
      const style = grid ? getComputedStyle(body) : null
      const columns = style ? Math.max(1, style.gridTemplateColumns.split(" ").length) : 1
      const gap = style ? parseFloat(style.rowGap) || 0 : 0
      const rows = materialWindow(Math.ceil(count / columns), offset, scroll.clientHeight,
        grid ? HOME_MATERIAL_CARD_HEIGHT + gap : HOME_MATERIAL_ROW_HEIGHT, grid ? 2 : OVERSCAN)
      const next = { start: rows.start * columns, end: Math.min(count, rows.end * columns), columns, gap }
      setRange((current) => current.start === next.start && current.end === next.end && current.columns === columns && current.gap === gap ? current : next)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(scroll)
    observer.observe(body)
    scroll.addEventListener("scroll", schedule, { passive: true })
    update()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroll.removeEventListener("scroll", schedule)
    }
  }, [bodyRef, count, enabled, folderPath, grid, scrollRef, windowed])

  const start = windowed ? Math.min(range.start, count) : 0
  const end = windowed ? Math.min(range.end, count) : count
  const top = start > 0 ? start / range.columns * (HOME_MATERIAL_CARD_HEIGHT + range.gap) - range.gap : 0
  const bottom = end < count ? (Math.ceil(count / range.columns) - Math.ceil(end / range.columns)) * (HOME_MATERIAL_CARD_HEIGHT + range.gap) - range.gap : 0
  return { start, end, top, bottom }
}

export function useHomeMaterialWindow(count: number, scrollRef: RefObject<HTMLDivElement | null>, bodyRef: RefObject<HTMLTableSectionElement | null>, enabled: boolean, folderPath: string) {
  return useMaterialWindow(count, scrollRef, bodyRef, enabled, folderPath, false)
}

export function useHomeGridWindow(count: number, scrollRef: RefObject<HTMLDivElement | null>, gridRef: RefObject<HTMLDivElement | null>, enabled: boolean, folderPath: string) {
  return useMaterialWindow(count, scrollRef, gridRef, enabled, folderPath, true)
}

/** Renaming can move a selected item outside the virtualized window. */
export function useHomeMaterialFocus(path: string, paths: readonly string[], scrollRef: RefObject<HTMLDivElement | null>,
  bodyRef: RefObject<HTMLElement | null>, grid: boolean, onFocused: () => void) {
  const finish = useEventCallback(onFocused)
  useLayoutEffect(() => {
    const root = scrollRef.current, body = bodyRef.current, index = paths.indexOf(path)
    if (!path || index < 0 || !root || !body) return
    const style = grid ? getComputedStyle(body) : null
    const columns = style ? Math.max(1, style.gridTemplateColumns.split(/\s+/).length) : 1
    const gap = style ? parseFloat(style.rowGap) || 0 : 0
    const height = grid ? HOME_MATERIAL_CARD_HEIGHT : HOME_MATERIAL_ROW_HEIGHT
    const top = body.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
      + Math.floor(index / columns) * (height + gap)
    if (top < root.scrollTop) root.scrollTop = top
    else if (top + height > root.scrollTop + root.clientHeight) root.scrollTop = top + height - root.clientHeight
    root.focus({ preventScroll: true })
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const row = [...root.querySelectorAll<HTMLElement>("[data-ails-workspace-item]")].find(node => node.dataset.ailsWorkspaceItem === path)
        row?.focus({ preventScroll: true })
        finish()
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [bodyRef, finish, grid, path, paths, scrollRef])
}
