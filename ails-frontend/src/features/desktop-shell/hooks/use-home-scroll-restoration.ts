import { useLayoutEffect, useRef, type RefObject } from "react"

export function useHomeScrollRestoration(scrollRef: RefObject<HTMLDivElement | null>) {
  const position = useRef({ top: 0, left: 0 })

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    // Activity preserves component state, but hiding its DOM resets native scroll.
    // Restore before the virtual list measures its visible range and before paint.
    scroll.scrollTop = position.current.top
    scroll.scrollLeft = position.current.left
    const remember = () => {
      if (scroll.clientHeight) position.current = { top: scroll.scrollTop, left: scroll.scrollLeft }
    }
    scroll.addEventListener("scroll", remember, { passive: true })
    return () => {
      remember()
      scroll.removeEventListener("scroll", remember)
    }
  }, [scrollRef])
}
