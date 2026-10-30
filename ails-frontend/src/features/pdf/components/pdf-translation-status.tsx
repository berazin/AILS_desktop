import { Loader2, X } from "lucide-react"

import type { PdfController } from "../hooks/use-pdf-controller.ts"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

type PdfTranslationStatusProps = {
  canRetry: boolean
  error: string
  onCancel: () => void
  onCloseError: () => void
  onRetry: () => void
  progress: PdfController["translation"]["pdfTranslationProgress"]
}

export function PdfTranslationStatus({
  canRetry,
  error,
  onCancel,
  onCloseError,
  onRetry,
  progress,
}: PdfTranslationStatusProps) {
  if (progress) {
    const progressPercent = Math.round((progress.completed / Math.max(1, progress.total)) * 100)

    return (
      <div className="fixed bottom-6 left-1/2 z-[145] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-white/15 bg-zinc-950/95 p-4 text-white shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-sm font-bold">
          <span className="flex min-w-0 items-center gap-2">
            <Loader2 className="shrink-0 animate-spin text-emerald-300" size={16} />
            <span className="truncate">{progress.label}</span>
          </span>
          <span className="shrink-0 tabular-nums text-emerald-200">
            {progress.completed}/{progress.total} {t("페이지")}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-white/55">
          <button
            className="rounded px-2 py-1 font-bold text-white/70 transition hover:bg-white/10 hover:text-white"
            onClick={onCancel}
            type="button"
          >
            {t("중단")}
          </button>
          <span>{progressPercent}%</span>
        </div>
      </div>
    )
  }

  if (!error) return null

  return (
    <div className="fixed bottom-6 left-1/2 z-[145] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-red-400/30 bg-zinc-950/95 p-4 text-white shadow-2xl backdrop-blur">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-red-500/15 p-2 text-red-300"><X size={16} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-red-200">{t("PDF 번역에 실패했습니다")}</div>
          <div className="mt-1 break-words text-xs leading-5 text-white/65">{error}</div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button className="text-white hover:bg-white/10" onClick={onCloseError} size="sm" variant="ghost">{t("닫기")}</Button>
        {canRetry && <Button onClick={onRetry} size="sm">{t("다시 시도")}</Button>}
      </div>
    </div>
  )
}
