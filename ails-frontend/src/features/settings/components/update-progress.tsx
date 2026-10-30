import { t } from "../../../lib/i18n.ts"
import { updateByteLabel, type UpdateStatus } from "../lib/update-status.ts"

export function UpdateProgress({ status }: { status: UpdateStatus }) {
  if (["ready", "installing"].includes(status.state)) {
    return <p className="mt-4 text-xs leading-5 text-[var(--muted-foreground)]">{t("설치가 완료되었습니다. 잠시 후 AILS를 닫고 새 버전으로 다시 엽니다.")}</p>
  }
  if (["downloaded", "preparing", "preparing-tools", "verifying"].includes(status.state)) {
    return (
      <div className="ails-update-progress">
        <div role="progressbar" aria-label={t("새 버전 설치")} className="ails-update-track">
          <div className="ails-update-fill" data-indeterminate />
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">{t("설치가 끝날 때까지 AILS에서 계속 작업할 수 있습니다.")}</p>
      </div>
    )
  }
  if (status.state !== "downloading") return null
  const total = status.totalBytes ?? 0
  const transferred = status.transferredBytes ?? 0
  const speed = status.bytesPerSecond ?? 0
  const determinate = total > 0 || status.progressPercent > 0

  return (
    <div className="ails-update-progress">
      <div
        role="progressbar"
        aria-label={t("업데이트 다운로드")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? status.progressPercent : undefined}
        className="ails-update-track"
      >
        <div className="ails-update-fill" data-indeterminate={!determinate || undefined} style={determinate ? { width: `${status.progressPercent}%` } : undefined} />
      </div>
      <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-[11px] tabular-nums text-[var(--muted-foreground)]">
        <span>{total > 0 ? `${updateByteLabel(transferred)} / ${updateByteLabel(total)}` : t("업데이트 파일을 준비하고 있습니다.")}</span>
        {speed > 0 && <span>{updateByteLabel(speed)}/s</span>}
      </p>
      <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">{t("설치가 끝날 때까지 AILS에서 계속 작업할 수 있습니다.")}</p>
    </div>
  )
}
