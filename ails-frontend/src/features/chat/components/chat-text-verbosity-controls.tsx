import { t } from "../../../lib/i18n.ts"
import { useChatTextVerbosity } from "../hooks/use-chat-text-verbosity.ts"

const CHOICES = [["low", "요약"], ["medium", "일반"], ["high", "풍부"]] as const

export function ChatTextVerbosityControls() {
  const { verbosity, setVerbosity } = useChatTextVerbosity()
  return <div data-chat-text-verbosity className="flex flex-wrap items-center gap-2">
    <span className="text-xs text-[var(--muted-foreground)]">{t("답변 길이")}</span>
    <div role="group" aria-label={t("ChatGPT 답변 길이")} className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
      {CHOICES.map(([value, label]) => <button key={value} type="button" aria-pressed={verbosity === value}
        onClick={() => setVerbosity(value)}
        className={`rounded-md px-2.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-[var(--primary)] ${verbosity === value ? "bg-[var(--muted)] font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}>
        {t(label)}
      </button>)}
    </div>
  </div>
}
