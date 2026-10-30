import { useLayoutEffect, type RefObject } from "react"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { installTabWindowDrag } from "../lib/tab-window-drag.ts"
import type { installTabReorder } from "../lib/process-bar-tab-reorder.ts"
import type { TabTransferPreviewItem } from "../../../shared/workspace-tab-transfer.ts"
import "../components/tab-window-drag.css"

export function useTabWindowDrag(container: RefObject<HTMLDivElement | null>, reorder: RefObject<ReturnType<typeof installTabReorder> | null>,
  items: TabTransferPreviewItem[], layoutKey: string) {
  const collect = useEventCallback(() => items)
  useLayoutEffect(() => {
    if (!container.current || !reorder.current) return
    return installTabWindowDrag(container.current, reorder.current, collect)
  }, [container, reorder, collect])
  useLayoutEffect(() => {
    // Native driver observes committed children; this effect also covers title
    // changes that retain the same DOM nodes.
    container.current?.dispatchEvent(new Event("ails:tab-layout"))
  }, [container, layoutKey])
}
