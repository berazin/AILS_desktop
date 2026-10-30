import { useLayoutEffect, useState, type RefObject } from "react"
import { workspaceListColumns } from "../lib/workspace-list-columns.ts"

export function useWorkspaceListColumns(containerRef: RefObject<HTMLDivElement | null>, enabled: boolean, actionWidth = 40) {
  const [width, setWidth] = useState(552)
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return
    const measure = (availableWidth = container.getBoundingClientRect().width) => {
      // Hidden containers have no layout box; retain their last layout.
      // clientWidth rounds away fractional scrollbar gutters and can make the
      // fixed-width columns wider than their actual content box.
      if (container.getClientRects().length > 0) setWidth(availableWidth)
    }
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width))
    observer.observe(container)
    measure()
    return () => observer.disconnect()
  }, [containerRef, enabled])
  return workspaceListColumns(width, actionWidth)
}
