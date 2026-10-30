import { Gauge } from "lucide-react"

import type { WorkPreflight } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

function formatEstimatedTime(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  if (minutes < 60) return t("약 {p0}분", { p0: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? t("약 {p0}시간 {p1}분", { p0: hours, p1: rest }) : t("약 {p0}시간", { p0: hours })
}

function formatEstimatedCost(value: number | null | undefined) {
  return value == null ? t("ChatGPT 사용량 · 금액 환산 안 함") : `$${Number(value).toFixed(4)}`
}

export function WorkPreflightDialog({
  onResolve,
  preflight,
  showRoute,
}: {
  onResolve: (accepted: boolean) => void
  preflight: WorkPreflight | null
  showRoute: boolean
}) {
  if (!preflight) return null
  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60 p-4"
      data-work-preflight-dialog="true"
      onMouseDown={() => onResolve(false)}
    >
      <section
        className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[var(--brand)]/15 p-2 text-[var(--brand)]"><Gauge size={20} /></div>
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)]">{t("작업 실행 전 확인")}</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {preflight.execution === "local"
                ? t("이 작업은 내 PC에서만 처리합니다.")
                : preflight.execution === "external_ai"
                  ? t("이 작업은 외부 AI를 사용합니다.")
                  : t("이 작업은 내 PC 처리와 외부 AI 처리를 함께 사용합니다.")}
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {preflight.steps.map((step, index) => (
            <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--border)] p-3" key={`${step.kind}-${index}`}>
              <div>
                <div className="text-xs font-bold text-[var(--foreground)]">
                  {step.kind === "local" ? t("로컬 작업") : t("외부 AI 작업")}{step.conditional ? t(" · 문제 감지 시") : ""}
                </div>
                <div className="mt-1 text-sm text-[var(--muted-foreground)]">{step.label}</div>
              </div>
              <div className="shrink-0 text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                <div>{formatEstimatedTime(step.estimated_seconds)}</div>
                {step.kind === "external_ai" && <div className="mt-1">{formatEstimatedCost(step.estimated_cost_usd)}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 rounded-xl bg-black/5 p-3 text-sm dark:bg-white/5 sm:grid-cols-2">
          <div><span className="text-[var(--muted-foreground)]">{t("예상 작업 시간")}</span><strong className="ml-2">{formatEstimatedTime(preflight.estimated_seconds)}</strong></div>
          <div><span className="text-[var(--muted-foreground)]">{t("외부 AI 예상 비용")}</span><strong className="ml-2">{formatEstimatedCost(preflight.estimated_cost_usd)}</strong></div>
          {showRoute && preflight.route_type && preflight.route_type !== "local" && (
            <div className="flex items-center justify-between border-t border-[var(--border)] pt-2 mt-1 sm:col-span-2" data-preflight-route="true">
              <span className="text-[var(--muted-foreground)]">{t("AI 요청 경로")}</span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                preflight.route_type === "managed"
                  ? "bg-blue-500/15 text-blue-500 border border-blue-500/30"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
              }`}>
                {preflight.route_label ?? (preflight.route_type === "managed" ? t("라우팅 플랫폼 (AILS 크레딧)") : t("개인 API 키"))}
              </span>
            </div>
          )}
          {preflight.credit.enforced && (
            <>
              <div><span className="text-[var(--muted-foreground)]">{t("보유 크레딧")}</span><strong className="ml-2">{formatEstimatedCost(preflight.credit.available_usd)}</strong></div>
              <div><span className="text-[var(--muted-foreground)]">{t("필요 예약액")}</span><strong className="ml-2">{formatEstimatedCost(preflight.credit.required_usd)}</strong></div>
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--muted-foreground)]">{preflight.estimate_basis} {t("실제 비용은 완료 후 사용량으로 정산합니다.")}</p>
        {preflight.credit.reason && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-xs leading-5 ${preflight.allowed ? "bg-amber-500/10 text-amber-500" : "bg-red-500/10 text-red-400"}`}>
            {preflight.credit.reason}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onResolve(false)}>{t("취소")}</Button>
          <Button disabled={!preflight.allowed} onClick={() => onResolve(true)}>
            {preflight.allowed ? t("확인하고 시작") : t("크레딧 부족으로 시작 불가")}
          </Button>
        </div>
      </section>
    </div>
  )
}
