import { Download, Loader2, X } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

export function LibreOfficeInstallDialog({
  busy,
  error,
  onCancel,
  onInstall,
  path,
  title,
}: {
  busy: boolean
  error: string
  onCancel: () => void
  onInstall: () => void
  path: string
  title: string
}) {
  if (!path) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <section
        aria-labelledby="libreoffice-install-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        role="dialog"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="libreoffice-install-title" className="text-lg font-semibold">{t("LibreOffice 설치")}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {t("PPT/PPTX를 슬라이드로 렌더링하려면 LibreOffice가 필요합니다. 설치에 동의하면 winget으로 자동 설치한 뒤 파일을 다시 엽니다.")}
            </p>
          </div>
          <Button onClick={onCancel} size="icon" type="button" variant="ghost"><X size={18} /></Button>
        </div>
        <div className="rounded-lg bg-[var(--muted)] p-3 text-sm font-medium">{title}</div>
        {busy && (
          <div className="mt-3 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand-soft)] p-3 text-sm leading-6 text-[var(--foreground)]">
            <div className="flex items-center gap-2 font-medium">
              <Loader2 className="animate-spin text-[var(--brand)]" size={15} />
              {t("LibreOffice 설치를 진행 중입니다.")}
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {t("winget과 Windows 설치 관리자가 실행 중일 수 있습니다. 설치 환경에 따라 몇 분 정도 걸릴 수 있으며, 완료되면 파일을 자동으로 다시 엽니다.")}
            </p>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button disabled={busy} onClick={onCancel} type="button" variant="outline">{t("취소")}</Button>
          <Button disabled={busy} onClick={onInstall} type="button">
            {busy ? <Loader2 className="animate-spin" size={15} /> : <Download size={15} />}
            {t("설치")}
          </Button>
        </div>
      </section>
    </div>
  )
}
