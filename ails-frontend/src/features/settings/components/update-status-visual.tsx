import { Check, CheckCircle2, Download, Loader2, RefreshCw, TriangleAlert } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { updateIsBusy, type UpdateStatus } from "../lib/update-status.ts"

export function UpdateStatusIcon({ status, size = 22 }: { status: UpdateStatus; size?: number }) {
  if (status.state === "error") return <TriangleAlert size={size} />
  if (["up-to-date", "ready"].includes(status.state)) return <CheckCircle2 size={size} />
  if (status.state === "downloading") return <Download size={size} />
  if (updateIsBusy(status)) return <Loader2 className="motion-safe:animate-spin" size={size} />
  return <RefreshCw size={size} />
}

export function UpdateStages({ status }: { status: UpdateStatus }) {
  const stage = status.state === "downloading" ? 0
    : ["downloaded", "preparing", "preparing-tools", "verifying"].includes(status.state) ? 1
      : ["ready", "installing"].includes(status.state) ? 2 : -1
  if (stage < 0) return null

  return (
    <ol className="ails-update-stages" aria-label={t("업데이트 진행 단계")}>
      {[t("다운로드"), t("설치"), t("다시 시작")].map((label, index) => (
        <li key={index} data-complete={index < stage || undefined} aria-current={index === stage ? "step" : undefined}>
          <span className="ails-update-stage-number" aria-hidden="true">{index < stage ? <Check size={12} /> : index + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  )
}
