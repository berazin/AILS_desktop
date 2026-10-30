import { useLayoutEffect, useRef, type RefObject } from "react"

// Finish layout changes before paint when changing tabs; direct panel toggles
// on the same tab retain their CSS transitions.
export function useTabLayoutMotion(elementRef: RefObject<HTMLElement | null>, tabKey: string) {
  const previousTabKey = useRef(tabKey)
  useLayoutEffect(() => {
    // There is no previous tab layout to finish on mount. getAnimations can
    // force style/layout for the whole workspace while its first view loads.
    if (previousTabKey.current === tabKey) return
    previousTabKey.current = tabKey
    for (const animation of elementRef.current?.getAnimations() ?? []) {
      if ("transitionProperty" in animation) animation.cancel()
    }
  }, [elementRef, tabKey])
}
