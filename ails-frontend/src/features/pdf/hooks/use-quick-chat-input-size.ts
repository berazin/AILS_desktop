import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react"

/** Resize the uncontrolled input without rendering the workspace per keystroke. */
export function useQuickChatInputSize(inputRef: RefObject<HTMLTextAreaElement | null>, visible: boolean, draft: string, open: boolean) {
  const [overflow, setOverflow] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const expandedRef = useRef(false), overflowRef = useRef(false)
  const measured = useRef<{ input: HTMLTextAreaElement; text: string; key: string } | null>(null)
  const resize = useCallback(() => {
    // The closed composer stays mounted for draft/IME ownership, but its
    // off-screen layout must not force a document-wide layout during startup.
    if (!visible || !open) return
    const input = inputRef.current
    if (!input) return
    const style = getComputedStyle(input)
    const line = parseFloat(style.lineHeight) || 24
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
    const key = () => `${input.clientWidth}:${line}:${padding}:${expandedRef.current}:${window.innerHeight}`
    if (measured.current?.input === input && measured.current.text === input.value && measured.current.key === key()) return
    const compact = line * 3 + padding
    const scrollTop = input.scrollTop
    input.style.height = "0px"
    // A wrapped placeholder is not draft content and must not enlarge an empty input.
    const content = input.value ? input.scrollHeight : line + padding
    const nextOverflow = content > compact + 1
    if (!nextOverflow && expandedRef.current) { expandedRef.current = false; setExpanded(false) }
    const limit = expandedRef.current
      ? Math.max(compact, Math.min(420, Math.floor(window.innerHeight * 0.5 / line) * line + padding)) : compact
    input.style.height = `${Math.max(line + padding, Math.min(content, limit))}px`
    input.style.overflowY = content > limit + 1 ? "auto" : "hidden"
    input.scrollTop = input.selectionEnd === input.value.length ? input.scrollHeight - input.clientHeight : scrollTop
    if (nextOverflow !== overflowRef.current) { overflowRef.current = nextOverflow; setOverflow(nextOverflow) }
    measured.current = { input, text: input.value, key: key() }
  }, [inputRef, visible, open])

  useLayoutEffect(() => {
    if (!visible || !open) return
    const input = inputRef.current
    if (!input) return
    let width = input.clientWidth
    const observer = new ResizeObserver(() => {
      if (width !== input.clientWidth) { width = input.clientWidth; resize() }
    })
    observer.observe(input)
    input.addEventListener("input", resize)
    window.addEventListener("resize", resize)
    resize()
    return () => { observer.disconnect(); input.removeEventListener("input", resize); window.removeEventListener("resize", resize) }
  }, [inputRef, resize, visible, open])
  useLayoutEffect(() => { resize() }, [resize, draft, open, visible])

  const toggleExpanded = () => {
    const input = inputRef.current, scrollTop = input?.scrollTop ?? 0
    expandedRef.current = !expandedRef.current
    setExpanded(expandedRef.current)
    resize()
    input?.focus({ preventScroll: true })
    if (input) input.scrollTop = scrollTop
  }
  return { overflow, expanded, resize, toggleExpanded }
}
