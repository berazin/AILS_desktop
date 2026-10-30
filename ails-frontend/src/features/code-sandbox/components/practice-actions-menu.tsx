import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { MoreHorizontal } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import "./practice-window.css"

export function PracticeActionsMenu({ children, label = "문제 관리", onClose }: { children: ReactNode; label?: string; onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), id = useId()
  const popup = useRef<HTMLDivElement>(null)
  const close = useEventCallback(() => { setOpen(false); onClose?.() })
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!trigger.current || !popup.current) return
      const anchor = trigger.current.getBoundingClientRect(), panel = popup.current.getBoundingClientRect()
      const left = Math.max(8, Math.min(innerWidth - panel.width - 8, anchor.right - panel.width))
      const top = anchor.bottom + panel.height + 8 <= innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - panel.height - 6)
      setPosition({ left, top })
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true) }
  }, [open])
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target) && !popup.current?.contains(event.target)) close() }
    document.addEventListener("pointerdown", outside, true)
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside, true) }
  }, [open, close])
  return <div ref={root} className="relative shrink-0" onKeyDown={event => {
    if (!open || event.nativeEvent.isComposing) return
    event.stopPropagation()
    if (event.key === "Escape") { event.preventDefault(); close(); trigger.current?.focus() }
  }} onBlur={event => {
    if (!(event.relatedTarget instanceof Node && (root.current?.contains(event.relatedTarget) || popup.current?.contains(event.relatedTarget)))) close()
  }}>
    <button ref={trigger} type="button" aria-label={t(label)} title={t(label)} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      className="code-sandbox-button w-7 px-0" onClick={() => open ? close() : setOpen(true)}><MoreHorizontal size={15} /></button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label={t(label)} data-practice-actions-popup="true" style={position}
      className="ails-practice-actions-menu" onClick={event => {
        const button = (event.target as HTMLElement).closest("button")
        if (button && !button.disabled && !button.hasAttribute("aria-expanded")) close()
      }}>{children}</div>, document.body)}
  </div>
}
