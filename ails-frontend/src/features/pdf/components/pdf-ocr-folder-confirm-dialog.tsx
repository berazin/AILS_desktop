import { FileText, Loader2 } from "lucide-react"

import type { PdfOcrFolderPreflight } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

export type PdfOcrFolderConfirmation = {
  path: string
  name: string
  preflight: PdfOcrFolderPreflight
}

export function PdfOcrFolderConfirmDialog({
  confirmation,
  confirmDisabled,
  downloadInProgress,
  onCancel,
  onConfirm,
  profileError,
  profileLoading,
}: {
  confirmation: PdfOcrFolderConfirmation | null
  confirmDisabled: boolean
  downloadInProgress: boolean
  onCancel: () => void
  onConfirm: () => void
  profileError: string
  profileLoading: boolean
}) {
  if (!confirmation) return null
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4" onMouseDown={onCancel}>
      <section
        className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[var(--brand)]/15 p-2 text-[var(--brand)]"><FileText size={20} /></div>
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)]">{t("폴더 전체 OCR")}</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{confirmation.name}</p>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand)]/10 p-4 text-sm leading-6">
          <p className="font-semibold">{t("OCR 전에 모든 PDF의 텍스트 레이어를 확인했습니다.")}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("검색 가능한 텍스트가 있는 PDF는 변경하지 않고 자동으로 건너뜁니다. OCR 직전에도 다시 검사합니다.")}</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-[var(--muted)] p-3"><div className="text-[var(--muted-foreground)]">{t("전체 PDF")}</div><div className="mt-1 text-base font-bold">{confirmation.preflight.pdf_count}</div></div>
          <div className="rounded-lg bg-[var(--muted)] p-3"><div className="text-[var(--muted-foreground)]">{t("OCR 대상")}</div><div className="mt-1 text-base font-bold">{confirmation.preflight.ocr_count}</div></div>
          <div className="rounded-lg bg-[var(--muted)] p-3"><div className="text-[var(--muted-foreground)]">{t("텍스트 제외")}</div><div className="mt-1 text-base font-bold">{confirmation.preflight.skipped_text_count}</div></div>
          <div className="rounded-lg bg-[var(--muted)] p-3"><div className="text-[var(--muted-foreground)]">{t("읽기 실패")}</div><div className="mt-1 text-base font-bold">{confirmation.preflight.unreadable_count}</div></div>
        </div>
        {confirmation.preflight.pdf_count === 0 && <p className="mt-3 text-xs text-amber-500">{t("이 폴더와 하위 폴더에 PDF가 없습니다.")}</p>}
        {profileLoading && <div className="mt-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)]"><Loader2 className="animate-spin" size={14} /> {t("OCR 실행 환경 확인 중")}</div>}
        {profileError && <p className="mt-3 text-xs text-red-400">{t("OCR 실행 환경 확인 실패: ")}{profileError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>{t("취소")}</Button>
          <Button disabled={confirmDisabled} onClick={onConfirm}>
            {downloadInProgress ? <Loader2 className="animate-spin" size={15} /> : null}{t("OCR 확인")}
          </Button>
        </div>
      </section>
    </div>
  )
}
