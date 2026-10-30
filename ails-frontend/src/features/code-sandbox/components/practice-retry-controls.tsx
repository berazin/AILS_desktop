import { t } from "../../../lib/i18n.ts"
import type { PracticeRetryMode } from "../../../lib/api.ts"

export function PracticeRetryControls({ total, wrong, selected, disabled, mode, visibleCount, onStart, onExit }: {
  total: number; wrong: number; selected: number; disabled: boolean
  mode: PracticeRetryMode | null; visibleCount: number
  onStart: (mode: PracticeRetryMode) => void; onExit: () => void
}) {
  return <div className="my-2 space-y-2 text-xs" data-practice-retry-controls="true">
    <select aria-label={t("다시 풀기 범위")} value="" disabled={disabled || !total} className="h-8 w-full rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[var(--foreground)]" onChange={event => {
      const mode = event.currentTarget.value as PracticeRetryMode
      event.currentTarget.value = ""
      if (mode) onStart(mode)
    }}>
      <option value="">{t("다시 풀기")}</option>
      <option value="wrong" disabled={!wrong}>{t("틀린 문제만 다시 풀기")} ({wrong})</option>
      <option value="selected" disabled={!selected}>{t("선택한 문제 다시 풀기")} ({selected})</option>
      <option value="all">{t("전체 다시 풀기")} ({total})</option>
    </select>
    {mode && <div className="flex flex-wrap items-center justify-between gap-1 rounded bg-[var(--muted)] p-2" data-practice-retry-session={mode}>
      <span>{mode === "wrong" ? t("틀린 문제") : mode === "selected" ? t("선택한 문제") : t("전체 문제")} · {visibleCount}{t("개")}</span>
      <button className="rounded border border-[var(--border)] px-2 py-1" type="button" disabled={disabled} onClick={onExit}>{t("전체 목록")}</button>
    </div>}
  </div>
}
