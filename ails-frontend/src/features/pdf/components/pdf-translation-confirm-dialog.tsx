import { Languages } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

export function PdfTranslationConfirmDialog({
  onCancel,
  onConfirm,
  path,
  providerLabel,
}: {
  onCancel: () => void
  onConfirm: () => void
  path: string
  providerLabel: string
}) {
  if (!path) return null
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4" onMouseDown={onCancel}>
      <section
        className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[var(--brand)]/15 p-2 text-[var(--brand)]"><Languages size={20} /></div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[var(--foreground)]">{t("PDF 한국어 번역")}</h2>
            <p className="mt-2 break-all text-sm leading-6 text-[var(--muted-foreground)]">{path.split(/[\\/]/).pop()}</p>
          </div>
        </div>
        <div className="mt-4 space-y-2 rounded-lg border border-[var(--border)] bg-black/5 p-3 text-xs leading-5 text-[var(--muted-foreground)] dark:bg-white/5">
          <p>{providerLabel}{t("로 문서 전체를 한국어로 번역하며 API 사용량에 따라 비용이 발생합니다.")}</p>
          <p>{t("원본은 변경하지 않고 같은 폴더에 ")}<strong className="text-[var(--foreground)]">-ko.pdf</strong> {t("파일로 저장합니다.")}</p>
          <p>{t("이미지 PDF는 먼저 OCR이 완료되어 있어야 하며, 그림과 페이지 배치는 원본에서 유지합니다.")}</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>{t("취소")}</Button>
          <Button onClick={onConfirm}><Languages size={15} />{t("번역 시작")}</Button>
        </div>
      </section>
    </div>
  )
}
