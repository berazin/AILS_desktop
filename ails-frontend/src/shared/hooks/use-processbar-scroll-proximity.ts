import { useEffect, type RefObject } from "react"
import { installWorkspaceScrollbars } from "../ui/workspace-scrollbars.ts"

export function useProcessbarScrollProximity(scrollRef: RefObject<HTMLDivElement | null>, enabled = true) {
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !enabled) return
    return installWorkspaceScrollbars(root.ownerDocument)
  }, [scrollRef, enabled])
}
