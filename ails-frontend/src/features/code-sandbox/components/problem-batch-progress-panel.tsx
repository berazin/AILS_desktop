import { X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { cancelBackgroundProblemBatch, dismissBackgroundProblemBatch, useProblemBatchGrading } from "../hooks/use-problem-batch-grading.ts"

export function ProblemBatchProgressPanel() {
  const batches = useProblemBatchGrading()
  if (!batches.length) return null
  return <section className="max-h-40 shrink-0 overflow-y-auto border-b border-[var(--border)] bg-[var(--panel)] px-3 py-2" data-problem-batch-progress="true">
    {batches.map(batch => <div className="py-1 text-[11px]" data-problem-batch-id={batch.id} data-batch-status={batch.status} data-source-pdf={batch.pdfPath} key={batch.id}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold" role="status">
          {batch.pdfPath.split(/[\\/]/).pop()} · {batch.status === "running" ? t("묶음 채점 중") : batch.status === "cancelled" ? t("묶음 채점 중단됨") : batch.status === "failed" ? t("묶음 채점 실패") : t("묶음 채점 완료")}
          {` ${batch.completed}/${batch.total}`}
        </span>
        {batch.status === "running" ? <button className="code-sandbox-button" onClick={() => cancelBackgroundProblemBatch(batch.id)} type="button">{t("중단")}</button>
          : <button aria-label={t("묶음 채점 결과 닫기")} className="shrink-0 rounded p-1 hover:bg-[var(--muted)]" onClick={() => dismissBackgroundProblemBatch(batch.id)} type="button"><X size={12} /></button>}
      </div>
      <progress aria-label={t("묶음 채점 진행률")} className="block h-1 w-full accent-[var(--brand)]" max={batch.total || 1}
        value={batch.completed} />
      <div className="mt-1 truncate text-[var(--muted-foreground)]">
        {t("정답 ")}{batch.correct} · {t("오답 ")}{batch.incorrect} · {t("건너뜀 ")}{batch.skipped} · {t("실패 ")}{batch.failed} · {t("보류 ")}{batch.unresolved ?? 0}
      </div>
      {batch.currentLabel && <div className="truncate text-[var(--muted-foreground)]" title={batch.currentLabel}>{batch.currentLabel}</div>}
    </div>)}
  </section>
}
