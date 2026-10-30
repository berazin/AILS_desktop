import { X } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

export function PdfProblemAutoReviewErrorNotice({ error, onClose, visible }: {
  error: string
  onClose: () => void
  visible: boolean
}) {
  if (!visible || !error) return null
  return (
    <div className="fixed bottom-6 left-1/2 z-[146] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-red-400/30 bg-zinc-950/95 p-4 text-white shadow-2xl backdrop-blur">
      <div className="text-sm font-bold text-red-200">{t("AI 문제 검수를 시작하지 못했습니다")}</div>
      <div className="mt-1 break-words text-xs leading-5 text-white/65">{error}</div>
      <div className="mt-3 flex justify-end"><Button size="sm" variant="ghost" onClick={onClose}>{t("닫기")}</Button></div>
    </div>
  )
}

export function PdfOcrErrorNotice({ canRetry, error, onClose, onRetry, visible }: {
  canRetry: boolean
  error: string
  onClose: () => void
  onRetry: () => void
  visible: boolean
}) {
  if (!visible || !error) return null
  return (
    <div className="fixed bottom-6 left-1/2 z-[145] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border border-red-400/30 bg-zinc-950/95 p-4 text-white shadow-2xl backdrop-blur">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-red-500/15 p-2 text-red-300"><X size={16} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-red-200">{t("PDF 전체 OCR에 실패했습니다")}</div>
          <div className="mt-1 break-words text-xs leading-5 text-white/65">{error}</div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button className="text-white hover:bg-white/10" variant="ghost" size="sm" onClick={onClose}>{t("닫기")}</Button>
        {canRetry && <Button size="sm" onClick={onRetry}>{t("다시 시도")}</Button>}
      </div>
    </div>
  )
}
