import { t } from "../../../lib/i18n.ts"
import { useState } from "react"
import { ArrowRight, Loader2, RefreshCw } from "lucide-react"

import { Button } from "../../../shared/ui/button.tsx"
import { useUpdateStatus } from "../hooks/use-update-status.ts"
import { updateIsBusy, updateStatusLabel, type UpdateStatus } from "../lib/update-status.ts"
import { UpdateProgress } from "./update-progress.tsx"
import { UpdateStages, UpdateStatusIcon } from "./update-status-visual.tsx"
import "./update-ui.css"

function statusDescription(status: UpdateStatus) {
  switch (status.state) {
    case "unavailable": return t("이 환경에서는 자동 업데이트를 사용할 수 없습니다.")
    case "checking": return t("새 버전이 있는지 확인하고 있습니다.")
    case "up-to-date": return t("현재 최신 버전을 사용하고 있습니다.")
    case "error": return t("연결 상태를 확인한 뒤 다시 시도해 주세요.")
    case "idle": return t("업데이트를 확인해 최신 버전을 받아보세요.")
    default: return ""
  }
}

export function UpdateSettingsPanel() {
  const { status, setStatus, bridge } = useUpdateStatus()
  const [busy, setBusy] = useState(false)
  const disabled = !status.supported || Boolean(busy) || updateIsBusy(status)
  const description = statusDescription(status)
  const tone = status.state === "error" ? "warning"
    : ["up-to-date", "ready"].includes(status.state) ? "success" : "default"

  async function run() {
    setBusy(true)
    try {
      const next = await bridge?.check_for_updates?.()
      if (next) setStatus(next)
    } catch (error) {
      setStatus((current) => ({ ...current, state: "error", error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="settings-update" className="ails-update-panel" data-tone={tone} aria-label={t("업데이트")}>
      <div className="ails-update-body">
        <div className="ails-update-heading">
          <div className="ails-update-icon" aria-hidden="true"><UpdateStatusIcon status={status} /></div>
          <div className="min-w-0 flex-1">
            <p className="ails-update-eyebrow">AILS Desktop</p>
            <h3 role="status" aria-live="polite" className="text-lg font-semibold leading-7 tracking-tight">{updateStatusLabel(status)}</h3>
            {description && <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">{description}</p>}
          </div>
        </div>

        <div className="ails-update-versions">
          <dl>
            <dt>{t("현재 버전 ")}</dt>
            <dd>{status.currentVersion}</dd>
          </dl>
          <ArrowRight size={18} className="text-[var(--muted-foreground)]" aria-hidden="true" />
          <dl>
            <dt>{t("새 버전")}</dt>
            <dd className={status.updateVersion ? "text-[var(--update-accent)]" : "text-[var(--muted-foreground)]"}>
              {status.updateVersion || (status.state === "up-to-date" ? status.currentVersion : "—")}
            </dd>
          </dl>
        </div>

        <UpdateStages status={status} />
        <UpdateProgress status={status} />
        {status.error && <div className="ails-update-error" role="alert">{status.error}</div>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-[var(--muted-foreground)]">{status.supported
            ? t("새 버전이 있으면 자동으로 다운로드하고 설치합니다.")
            : t("자동 업데이트를 지원하는 설치판에서 이용할 수 있습니다.")}</p>
          <Button disabled={disabled} onClick={() => void run()} type="button" size="lg">
            {busy ? <Loader2 className="motion-safe:animate-spin" size={15} /> : <RefreshCw size={15} />}
            {t("업데이트 확인")}
          </Button>
        </div>
      </div>

    </section>
  )
}
