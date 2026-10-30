import { SlidersHorizontal } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import { t } from "../../../lib/i18n.ts"
import { useChatComposerPopover } from "../hooks/use-chat-composer-popover.ts"
import { ChatGPTUsageGauge } from "./chatgpt-usage-gauge.tsx"
import { ChatTextVerbosityControls } from "./chat-text-verbosity-controls.tsx"
import "./chat-composer-controls.css"

export function ChatGPTOptionsPopover({ busy = false }: { busy?: boolean }) {
  const { root, trigger, open, present, close, show, toggle, onKeyDown, onBlur } = useChatComposerPopover("chatgpt-options", { focusOnOpen: false })
  const id = useId()
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openedByHover = useRef(false)
  const cancelLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = null
  }
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current) }, [])
  useEffect(() => { if (!open) openedByHover.current = false }, [open])
  return <div ref={root} className="relative shrink-0" data-chatgpt-options
    onPointerEnter={event => { cancelLeave(); if (event.pointerType === "mouse" && !open) { openedByHover.current = true; show() } }}
    onPointerLeave={() => {
      cancelLeave()
      leaveTimer.current = setTimeout(() => {
        if (!root.current?.contains(document.activeElement)) close()
      }, 220)
    }}
    onFocusCapture={cancelLeave} onBlur={onBlur} onKeyDown={event => {
      onKeyDown(event)
      if (!event.nativeEvent.isComposing && event.target === trigger.current && event.key === "ArrowDown") {
        event.preventDefault(); openedByHover.current = false; show()
        requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="dialog"] button:not(:disabled)')?.focus({ preventScroll: true }))
      }
    }}>
    <button ref={trigger} type="button" aria-label={t("ChatGPT 옵션")} title={t("사용량 및 답변 길이")}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={event => {
        if (event.detail > 0 && openedByHover.current) show()
        else toggle()
        openedByHover.current = false
      }}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${open ? "bg-[var(--muted)]" : ""}`}>
      <SlidersHorizontal size={13} aria-hidden="true" />{t("옵션")}
    </button>
    <div id={id} role="dialog" aria-label={t("ChatGPT 사용량 및 답변 길이")} aria-hidden={!open}
      hidden={!present} inert={!open} data-chat-composer-popup="chatgpt-options" data-state={open ? "open" : "closed"}
      className="ails-chat-composer-popup absolute bottom-full right-0 z-50 mb-3 w-[min(340px,calc(100vw-32px))] rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow-xl">
      <div className="mb-3 text-xs font-medium text-[var(--foreground)]">{t("ChatGPT 옵션")}</div>
      {/* Keep the shared quota subscription alive while the popup is hidden. */}
      <ChatGPTUsageGauge busy={busy} />
      <div className="mt-3 border-t border-[var(--border)] pt-3"><ChatTextVerbosityControls /></div>
    </div>
  </div>
}
