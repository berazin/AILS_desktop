import { t } from "../../../lib/i18n.ts"

export function PracticeMultipleChoice({
  choices,
  disabled,
  onBlur,
  onSelect,
  selectedIndex,
}: {
  choices: readonly string[]
  disabled: boolean
  onBlur?: () => void
  onSelect: (index: number) => void
  selectedIndex: number | null
}) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-bold text-[var(--muted-foreground)]">{t("답안 선택")}</div>
      <div className="space-y-2">
        {choices.map((choice, index) => {
          const selected = selectedIndex === index
          return (
            <button
              aria-pressed={selected}
              className={`flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
                selected
                  ? "border-[var(--brand)]/60 bg-[var(--brand-soft)] text-[var(--foreground)]"
                  : "border-[var(--border)] bg-[var(--practice-panel)] text-[var(--foreground)] hover:bg-[var(--muted)]"
              }`}
              disabled={disabled}
              key={`${index}-${choice}`}
              onBlur={onBlur}
              onClick={() => onSelect(index)}
              type="button"
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                selected ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--border)] text-[var(--muted-foreground)]"
              }`}>{index + 1}</span>
              <span className="whitespace-pre-wrap text-[12px] leading-5">{choice}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
