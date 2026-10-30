import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { workspaceMarqueePaths, workspaceSelectionRect, type WorkspaceItemLayout, type WorkspacePoint, type WorkspaceSelectionRect } from "../lib/workspace-marquee.ts"

type Options = {
  scrollRef: RefObject<HTMLDivElement | null>
  paths: readonly string[]
  selectedPaths: ReadonlySet<string>
  anchor: string
  viewMode: "list" | "grid"
  folderPath: string
  onSelect: (paths: Iterable<string>, anchor?: string) => void
  onBegin: () => void
}
type Drag = {
  root: HTMLDivElement; pointerId: number; startClient: WorkspacePoint; start: WorkspacePoint; client: WorkspacePoint
  initial: Set<string>; anchor: string; additive: boolean; active: boolean; frame: number; frameTime: number
  cleanup: () => void
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function contentPoint(root: HTMLElement, client: WorkspacePoint): WorkspacePoint {
  const bounds = root.getBoundingClientRect()
  return { x: clamp(client.x - bounds.left - root.clientLeft, 0, root.clientWidth) + root.scrollLeft,
    y: clamp(client.y - bounds.top - root.clientTop, 0, root.clientHeight) + root.scrollTop }
}

function itemLayout(root: HTMLElement, grid: boolean): WorkspaceItemLayout | null {
  const item = root.querySelector<HTMLElement>("[data-ails-workspace-item][data-ails-workspace-index]")
  if (!item) return null
  const parent = item.parentElement!, style = grid ? getComputedStyle(parent) : null
  const bounds = item.getBoundingClientRect(), viewport = root.getBoundingClientRect()
  const columns = style ? style.gridTemplateColumns.split(/\s+/).map(parseFloat).filter(width => width > 0) : [bounds.width]
  if (!columns.length || bounds.height <= 0) return null
  const columnGap = style ? parseFloat(style.columnGap) || 0 : 0, rowGap = style ? parseFloat(style.rowGap) || 0 : 0
  const index = Number(item.dataset.ailsWorkspaceIndex), column = index % columns.length
  return { left: bounds.left - viewport.left - root.clientLeft + root.scrollLeft
      - columns.slice(0, column).reduce((sum, width) => sum + width + columnGap, 0),
    top: bounds.top - viewport.top - root.clientTop + root.scrollTop - Math.floor(index / columns.length) * (bounds.height + rowGap),
    columns, columnGap, rowGap, itemHeight: bounds.height }
}

function edgeScroll(value: number, min: number, max: number) {
  const edge = Math.min(32, (max - min) / 4)
  if (value < min + edge) return -28 * clamp((min + edge - value) / edge, 0, 1)
  if (value > max - edge) return 28 * clamp((value - max + edge) / edge, 0, 1)
  return 0
}

function filenameHit(cell: Element, point: WorkspacePoint): boolean {
  const inside = (bounds: DOMRect) => point.x >= bounds.left && point.x <= bounds.right
    && point.y >= bounds.top && point.y <= bounds.bottom
  if ([...cell.querySelectorAll("svg")].some(icon => inside(icon.getBoundingClientRect()))) return true
  const label = cell.querySelector("[data-ails-workspace-name]")
  if (!label) return false
  const range = document.createRange()
  range.selectNodeContents(label)
  // The label fills its column, but only its visible text is a file drag
  // target. The unused part of the name column is still blank space.
  return inside(label.getBoundingClientRect()) && [...range.getClientRects()].some(inside)
}

export function useWorkspaceMarquee({ scrollRef, paths, selectedPaths, anchor, viewMode, folderPath, onSelect, onBegin }: Options) {
  const [rectangle, setRectangle] = useState<WorkspaceSelectionRect | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const select = useEventCallback(onSelect), begin = useEventCallback(onBegin)
  const update = useEventCallback((drag: Drag, scroll: boolean, time: number = 0) => {
    if (scroll) {
      const bounds = drag.root.getBoundingClientRect(), scale = drag.frameTime ? Math.min(32, time - drag.frameTime) / 16.67 : 1
      drag.frameTime = time
      drag.root.scrollTop += edgeScroll(drag.client.y, bounds.top, bounds.top + drag.root.clientHeight) * scale
      drag.root.scrollLeft += edgeScroll(drag.client.x, bounds.left, bounds.left + drag.root.clientWidth) * scale
    }
    const rect = workspaceSelectionRect(drag.start, contentPoint(drag.root, drag.client))
    const layout = itemLayout(drag.root, viewMode === "grid")
    const hit = layout ? workspaceMarqueePaths(paths, rect, layout) : []
    select(drag.additive ? new Set([...drag.initial, ...hit]) : hit, drag.additive ? drag.anchor : hit[0] ?? "")
    setRectangle(previous => previous && previous.left === rect.left && previous.top === rect.top
      && previous.width === rect.width && previous.height === rect.height ? previous : rect)
  })
  const finish = useEventCallback((restore: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    cancelAnimationFrame(drag.frame)
    drag.cleanup()
    if (drag.active) {
      suppressClick.current = true
      if (restore) select(drag.initial, drag.anchor)
    }
    if (drag.root.hasPointerCapture(drag.pointerId)) drag.root.releasePointerCapture(drag.pointerId)
    setRectangle(null)
  })

  useEffect(() => () => finish(false), [finish, folderPath, paths, viewMode])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    suppressClick.current = false
    if (event.button !== 0 || event.isPrimary === false || event.pointerType === "touch" || dragRef.current) return
    const root = scrollRef.current, target = event.target as Element
    if (!root || target.closest("button, a, input, textarea, select, th, [role='button'], [role='menu'], [role='dialog'], [contenteditable='true']")) return
    const item = target.closest("[data-ails-workspace-item]")
    // List metadata/empty cells remain drag surfaces. File names and grid
    // cards keep their existing click/double-click and future file-drag path.
    if (item && item.tagName !== "TR") return
    const nameCell = target.closest("[data-workspace-column='name']")
    if (nameCell && filenameHit(nameCell, { x: event.clientX, y: event.clientY })) return
    const bounds = root.getBoundingClientRect()
    if (event.clientX >= bounds.left + root.clientLeft + root.clientWidth || event.clientY >= bounds.top + root.clientTop + root.clientHeight) return
    const client = { x: event.clientX, y: event.clientY }
    const drag: Drag = { root, pointerId: event.pointerId, startClient: client, start: contentPoint(root, client), client,
      initial: new Set(selectedPaths), anchor, additive: event.ctrlKey || event.metaKey || event.shiftKey,
      active: false, frame: 0, frameTime: 0, cleanup: () => {} }
    dragRef.current = drag
    const tick = (time: number) => {
      if (dragRef.current !== drag) return
      update(drag, true, time)
      drag.frame = requestAnimationFrame(tick)
    }
    const move = (next: PointerEvent) => {
      if (next.pointerId !== drag.pointerId) return
      drag.client = { x: next.clientX, y: next.clientY }
      if (!drag.active) {
        if (Math.hypot(next.clientX - drag.startClient.x, next.clientY - drag.startClient.y) < 5) return
        drag.active = true
        begin()
        root.focus({ preventScroll: true })
        try { root.setPointerCapture(drag.pointerId) } catch { /* Window listeners also cover capture loss. */ }
        update(drag, false)
        drag.frame = requestAnimationFrame(tick)
      }
      next.preventDefault()
    }
    const up = (next: PointerEvent) => {
      if (next.pointerId !== drag.pointerId) return
      if (drag.active) { drag.client = { x: next.clientX, y: next.clientY }; update(drag, false) }
      finish(false)
    }
    const cancel = () => finish(true)
    const pointerCancel = (next: PointerEvent) => { if (next.pointerId === drag.pointerId) cancel() }
    const key = (next: KeyboardEvent) => {
      if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); cancel() }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", pointerCancel)
    window.addEventListener("keydown", key, true)
    window.addEventListener("blur", cancel)
    window.addEventListener("resize", cancel)
    root.addEventListener("lostpointercapture", pointerCancel)
    drag.cleanup = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", pointerCancel)
      window.removeEventListener("keydown", key, true)
      window.removeEventListener("blur", cancel)
      window.removeEventListener("resize", cancel)
      root.removeEventListener("lostpointercapture", pointerCancel)
    }
  }

  function onClickCapture(event: ReactMouseEvent) {
    if (suppressClick.current) { event.preventDefault(); event.stopPropagation() }
  }

  return { rectangle, onPointerDown, onClickCapture, onDoubleClickCapture: onClickCapture }
}
