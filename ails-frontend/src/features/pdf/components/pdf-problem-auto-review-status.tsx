import { Eye, Loader2 } from "lucide-react"

import type { PdfProblemAutoReviewStatus as PdfProblemAutoReviewStatusPayload } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

const ACTIVE_STATUSES = new Set(["queued", "running", "cancel_pending"])

function statusLabel(status: PdfProblemAutoReviewStatusPayload["status"]) {
  if (status === "queued") return t("AI 문제 검수 대기 중")
  if (status === "running") return t("AI 문제 검수 중")
  if (status === "cancel_pending") return t("현재 페이지 검수 후 취소")
  if (status === "completed") return t("AI 문제 검수 완료")
  if (status === "completed_with_errors") return t("일부 페이지를 제외하고 검수 완료")
  if (status === "cancelled") return t("AI 문제 검수 취소됨")
  if (status === "budget_exhausted") return t("검수 예산 한도에서 중지됨")
  if (status === "budget_accounting_error") return t("비용 확인 실패로 중지됨")
  if (status === "stale") return t("문제 목록 변경으로 중지됨")
  if (status === "interrupted") return t("백엔드 종료로 중단됨")
  if (status === "failed") return t("AI 문제 검수 실패")
  return t("AI 문제 검수")
}

export function PdfProblemAutoReviewStatus({
  onCancel,
  status,
  visible,
}: {
  onCancel: () => void
  status: PdfProblemAutoReviewStatusPayload | null
  visible: boolean
}) {
  if (!visible || !status) return null

  return (
    <div
      className="fixed bottom-6 left-1/2 z-[145] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-cyan-300/25 bg-zinc-950/95 p-4 text-white shadow-2xl backdrop-blur"
      data-pdf-problem-auto-review-status="true"
    >
      <div className="flex items-center justify-between gap-3 text-sm font-bold">
        <span className="flex items-center gap-2">
          {ACTIVE_STATUSES.has(status.status)
            ? <Loader2 className="animate-spin text-cyan-300" size={16} />
            : <Eye className="text-cyan-300" size={16} />}
          {status.run_scope === "review_queue" ? t("검토 문제 재검수 중") : statusLabel(status.status)}
        </span>
        <span className="tabular-nums text-cyan-200">{status.page_processed}/{status.page_total} {t("페이지")}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-cyan-500 transition-[width] duration-300"
          style={{ width: `${Math.round((status.page_processed / Math.max(1, status.page_total)) * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/60">
        <span>
          {t("적용 ")}{status.applied_problem_count ?? 0}{t("개 · 사용자 검토 ")}{status.queued_problem_count ?? 0}{t("개")}
          {status.current_page ? t(" · {p0}쪽", { p0: status.current_page }) : ""}
          {status.parallel_workers && status.parallel_workers > 1 ? t(" · 동시 {p0}페이지", { p0: status.parallel_workers }) : ""}
        </span>
        <span className="tabular-nums">
          ${Number(status.spent_usd || 0).toFixed(4)} / {status.budget_unlimited
            ? t("제한 없음")
            : `$${Number(status.budget_usd || 0).toFixed(2)}`}
        </span>
      </div>
      {status.errors?.length ? (
        <div className="mt-2 max-h-20 overflow-y-auto rounded-lg bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
          {status.errors[status.errors.length - 1]?.error}
        </div>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button disabled={status.status === "cancel_pending"} onClick={onCancel} size="sm" variant="outline">{t("취소")}</Button>
      </div>
    </div>
  )
}
