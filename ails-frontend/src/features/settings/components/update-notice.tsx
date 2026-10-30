import { useState } from "react"
import { ArrowUpRight, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { useUpdateStatus } from "../hooks/use-update-status.ts"
import { updateIsBusy, updateStatusLabel } from "../lib/update-status.ts"
import { UpdateProgress } from "./update-progress.tsx"
import { UpdateStages, UpdateStatusIcon } from "./update-status-visual.tsx"
import { Button } from "../../../shared/ui/button.tsx"
import "./update-ui.css"

export function UpdateNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { status } = useUpdateStatus()
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const failed = status.state === "error"
  const noticeKey = JSON.stringify([status.updateVersion, failed ? status.error : null])
  if (!status.supported || (!updateIsBusy(status) && !failed) || noticeKey === dismissedKey) return null

  return (
    <aside data-ails-update-notice className="ails-update-notice" data-tone={failed ? "warning" : status.state === "ready" ? "success" : "default"} aria-label={t("업데이트")}>
      <div className="flex items-start gap-3">
        <div className="ails-update-icon" aria-hidden="true"><UpdateStatusIcon status={status} size={18} /></div>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-medium text-[var(--muted-foreground)]">AILS{status.updateVersion ? ` · ${t("새 버전 {p0}", { p0: status.updateVersion })}` : ""}</p>
          <p className="text-xs font-semibold leading-5" role="status" aria-live="polite">{updateStatusLabel(status)}</p>
        </div>
        <Button type="button" aria-label={t("닫기")} title={t("닫기")} onClick={() => setDismissedKey(noticeKey)} variant="ghost" className="-mr-1 -mt-1 h-7 w-7 shrink-0 p-0"><X size={14} /></Button>
      </div>
      <UpdateStages status={status} />
      <UpdateProgress status={status} />
      {failed && (
        <>
          <p className="mt-3 break-words text-xs leading-5" role="alert">{status.error}</p>
          <Button type="button" onClick={onOpenSettings} variant="outline" size="sm" className="mt-3 text-xs">{t("설정 열기")}<ArrowUpRight size={13} /></Button>
        </>
      )}
    </aside>
  )
}
