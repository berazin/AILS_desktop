import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { useProcessbarScrollProximity } from "../../../shared/hooks/use-processbar-scroll-proximity.ts"

export function useChatComposerPopover(view?: string, { focusOnOpen = true }: { focusOnOpen?: boolean } = {}) {
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false), [present, setPresent] = useState(false)
  useProcessbarScrollProximity(root, present)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const close = useCallback(() => {
    setOpen(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setPresent(false), 180)
  }, [])
  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    setPresent(true); setOpen(true)
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (!open) return
    const tutor = root.current?.closest<HTMLElement>("[data-practice-tutor-mode]")
    const position = () => {
      const panel = root.current?.querySelector<HTMLElement>("[data-chat-composer-popup]")
      const parent = panel?.offsetParent
      if (!panel || !(parent instanceof HTMLElement)) return
      const bounds = trigger.current!.getBoundingClientRect(), ancestor = parent.getBoundingClientRect()
      const tutorBounds = tutor?.getBoundingClientRect()
      const scope = root.current?.closest<HTMLElement>("[data-ails-chat-composer],[data-ails-pdf-quick-chat]")?.getBoundingClientRect() ?? tutorBounds
      const minimum = Math.max(16, (scope?.left ?? 8) + 8), maximum = Math.min(window.innerWidth - 16, (scope?.right ?? window.innerWidth - 8) - 8)
      panel.style.maxWidth = `${maximum - minimum}px`
      const width = panel.getBoundingClientRect().width
      const left = Math.max(minimum, Math.min(bounds.right - width, maximum - width))
      // Longer reasoning labels grow the trigger to the left. Its right edge
      // stays fixed beside the mic/send controls, so anchor the popup there.
      panel.style.left = "auto"
      panel.style.right = `${(ancestor.right - left - width) / (ancestor.width / parent.offsetWidth || 1)}px`
      const above = tutorBounds ? bounds.top - Math.max(16, tutorBounds.top + 8) - 12 : bounds.top - 16
      const below = tutorBounds ? Math.min(window.innerHeight - 16, tutorBounds.bottom - 8) - bounds.bottom - 12 : window.innerHeight - bounds.bottom - 16
      const upwards = panel.getBoundingClientRect().height <= above || above >= below
      panel.style.bottom = upwards ? "calc(100% + 12px)" : "auto"
      panel.style.top = upwards ? "auto" : "calc(100% + 12px)"
      if (tutor) panel.style.marginBottom = "0"
      panel.style.maxHeight = `${Math.max(tutor ? 0 : 120, upwards ? above : below)}px`
      panel.style.overflowY = "auto"
    }
    const frame = requestAnimationFrame(() => {
      position()
      if (!focusOnOpen) return
      const panel = root.current?.querySelector<HTMLElement>("[data-chat-composer-popup]")
      const first = (view === "models" ? panel?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]:not(:disabled)') : null)
        ?? panel?.querySelector<HTMLElement>("input:not(:disabled)")
        ?? panel?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)')
        ?? panel?.querySelector<HTMLElement>("button:not(:disabled)")
      first?.focus({ preventScroll: true })
    })
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) close() }
    document.addEventListener("pointerdown", outside, true)
    window.addEventListener("resize", position)
    const observer = tutor ? new ResizeObserver(position) : null
    if (tutor) observer?.observe(tutor)
    if (trigger.current) observer?.observe(trigger.current)
    const panel = root.current?.querySelector<HTMLElement>("[data-chat-composer-popup]")
    if (panel) observer?.observe(panel)
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", position) }
  }, [open, view, close, focusOnOpen])
  const onKeyDown = (event: KeyboardEvent) => {
    if (!open || event.nativeEvent.isComposing) return
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus({ preventScroll: true })
    } else if (event.key.startsWith("Arrow") || ["Home", "End", "Enter", " "].includes(event.key)) {
      event.stopPropagation()
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault()
    }
  }
  const onBlur = (event: FocusEvent) => {
    if (open && !(event.relatedTarget instanceof Node && root.current?.contains(event.relatedTarget))) close()
  }
  return { root, trigger, open, present, close, show, toggle: () => open ? close() : show(), onKeyDown, onBlur }
}
