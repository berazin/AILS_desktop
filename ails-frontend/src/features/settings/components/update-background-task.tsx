import { t } from "../../../lib/i18n.ts"
import { updateIsBusy, updateStatusLabel, type UpdateStatus } from "../lib/update-status.ts"
import { UpdateProgress } from "./update-progress.tsx"
import { UpdateStatusIcon } from "./update-status-visual.tsx"
import "./update-ui.css"

export function UpdateBackgroundTask({ status }: { status: UpdateStatus }) {
  if (!status.supported || (!updateIsBusy(status) && status.state !== "error")) return null
  const failed = status.state === "error"
  return <section data-ails-update-task className="ails-update-panel mx-5 my-3 shrink-0 p-4"
    data-tone={failed ? "warning" : status.state === "ready" ? "success" : "default"} aria-label={t("업데이트")}>
    <div className="flex items-start gap-3">
      <div className="ails-update-icon" aria-hidden="true"><UpdateStatusIcon status={status} size={18} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold" role="status" aria-live="polite">{updateStatusLabel(status)}</p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">AILS{status.updateVersion ? ` · ${t("새 버전 {p0}", { p0: status.updateVersion })}` : ""}</p>
      </div>
    </div>
    <UpdateProgress status={status} />
    {failed && <p className="mt-3 break-words text-xs leading-5" role="alert">{status.error}</p>}
  </section>
}
