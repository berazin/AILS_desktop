import { useLayoutEffect, type RefObject } from "react"

const BOTTOM_TOLERANCE = 2

/** Keep the previous bottom position sticky even when content first starts overflowing. */
export function useChatBottomFollow(scrollRef: RefObject<HTMLDivElement | null>, messageKey: string) {
  useLayoutEffect(() => {
    const container = scrollRef.current
    const ownerWindow = container?.ownerDocument.defaultView
    if (!container || !ownerWindow) return

    const atBottom = () => container.scrollHeight - container.clientHeight - container.scrollTop <= BOTTOM_TOLERANCE
    let following = atBottom()
    let previousTop = container.scrollTop
    let frame = 0

    const follow = () => {
      frame = 0
      if (!following || container.clientHeight === 0) return
      container.scrollTop = container.scrollHeight
      previousTop = container.scrollTop
    }
    const schedule = () => {
      if (atBottom()) following = true
      if (following && !frame) frame = ownerWindow.requestAnimationFrame(follow)
    }
    const onScroll = () => {
      if (atBottom()) following = true
      // Content growth can emit a scroll event without an upward user movement.
      // Do not mistake the new distance from the bottom for an opt-out.
      else if (container.scrollTop < previousTop) following = false
      previousTop = container.scrollTop
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && container.scrollHeight > container.clientHeight + BOTTOM_TOLERANCE) {
        following = false
      }
    }

    // The viewport's size stays fixed during streaming; its content's size changes.
    // Observe direct children too, including Markdown/image layout after rendering.
    const resizeObserver = new ResizeObserver(schedule)
    const observedChildren = new Set<Element>()
    const observeChildren = () => {
      for (const child of observedChildren) {
        if (child.parentElement !== container) {
          resizeObserver.unobserve(child)
          observedChildren.delete(child)
        }
      }
      for (const child of container.children) {
        if (observedChildren.has(child)) continue
        resizeObserver.observe(child)
        observedChildren.add(child)
      }
      schedule()
    }
    const mutationObserver = new MutationObserver(observeChildren)
    resizeObserver.observe(container)
    observeChildren()
    mutationObserver.observe(container, { childList: true })
    container.addEventListener("scroll", onScroll, { passive: true })
    container.addEventListener("wheel", onWheel, { passive: true })
    return () => {
      ownerWindow.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      container.removeEventListener("scroll", onScroll)
      container.removeEventListener("wheel", onWheel)
    }
  }, [messageKey, scrollRef])
}
