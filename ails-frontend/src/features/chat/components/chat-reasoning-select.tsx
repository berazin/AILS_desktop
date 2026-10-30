import { ChevronDown } from "lucide-react"
import { useId } from "react"
import { t } from "../../../lib/i18n.ts"
import { useChatComposerPopover } from "../hooks/use-chat-composer-popover.ts"
import { chatReasoningLevel } from "../lib/chat-reasoning-levels.ts"
import { ChatReasoningSlider } from "./chat-reasoning-slider.tsx"
import "./chat-composer-controls.css"

export function ChatReasoningSelect({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  const { root, trigger, open, present, toggle, onKeyDown, onBlur } = useChatComposerPopover(), id = useId()
  const { label } = chatReasoningLevel(value)
  return <div ref={root} className="relative shrink-0" onKeyDown={onKeyDown} onBlur={onBlur}>
    <button ref={trigger} type="button" aria-label={t("추론 수준 선택")} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={id} disabled={disabled} onClick={toggle}
      className="flex items-center gap-1.5 rounded-xl px-2 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] disabled:opacity-40">
      <span>{t("추론")} · <span className="text-[var(--foreground)]">{label}</span></span><ChevronDown size={13} />
    </button>
    {present && <div id={id} role="dialog" aria-label={t("추론 수준")}
      data-chat-composer-popup="reasoning" data-state={open ? "open" : "closed"} inert={!open}
      className="ails-chat-composer-popup absolute bottom-full right-0 z-50 mb-3 w-[min(240px,calc(100vw-48px))] rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-3 py-3 shadow-xl">
      <div aria-live="polite" className="mb-3 text-center text-sm font-medium text-[var(--foreground)]">{label}</div>
      <ChatReasoningSlider value={value} onChange={onChange} disabled={disabled} />
    </div>}
  </div>
}
