import { useCallback, useState } from "react"
import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react"

import {
  downloadLocalModelsPrepareStream,
  getLocalModelsStatus,
  type LocalModelsStatus,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export function LocalModelsPrepareRow({
  onNotice,
  onStatusChange,
}: {
  onNotice?: (message: string) => void
  onStatusChange?: (status: LocalModelsStatus) => void
}) {
  const [status, setStatus] = useState<LocalModelsStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [stageTitle, setStageTitle] = useState("")
  const [progress, setProgress] = useState<{ completed: number; total: number; percent: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await getLocalModelsStatus()
      setStatus(res)
      onStatusChange?.(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("모델 상태를 확인하지 못했습니다."))
    } finally {
      setLoading(false)
    }
  }, [onStatusChange])

  async function handlePrepare() {
    try {
      setDownloading(true)
      setError(null)
      setProgress(null)
      setStageTitle(t("로컬 모델 준비 시작..."))

      await downloadLocalModelsPrepareStream(
        { confirmed: true },
        (event) => {
          if (event.type === "stage_start") {
            setStageTitle(String(event.title || t("모델 다운로드 중...")))
            setProgress(null)
          } else if (event.type === "model_download") {
            const completed = Number(event.completed_bytes || 0)
            const total = Number(event.total_bytes || 0)
            const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
            setProgress({ completed, total, percent })
          } else if (event.type === "all_models_ready") {
            if (event.status) {
              setStatus(event.status as LocalModelsStatus)
            }
          }
        },
      )

      await loadStatus()
      onNotice?.(t("정리본 생성에 필요한 모든 로컬 AI 모델이 준비되었습니다."))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("모델 다운로드 중 오류가 발생했습니다."))
    } finally {
      setDownloading(false)
      setProgress(null)
      setStageTitle("")
    }
  }

  const allReady = Boolean(status?.all_ready)
  const missingModels: string[] = []
  if (status) {
    if (!status.ocr?.ready) missingModels.push("PDF OCR")
    if (!status.stt?.ready) missingModels.push(t("보이스 STT ({p0})", { p0: status.stt?.selected_model || "Whisper" }))
    if (status.video_stt && !status.video_stt.ready) {
      missingModels.push(t("강의 정리 STT ({p0})", { p0: status.video_stt.selected_model || "Whisper" }))
    }
    if (!status.voice_agent?.ready) missingModels.push("로컬 AI (Qwen3)")
  }

  return (
    <div className="border-t border-[var(--border)] px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--foreground)]">{t("로컬 모델 일괄 준비")}</span>
            {!loading && allReady && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={12} />
                {t("준비 완료")}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">
            {allReady
              ? t("정리본 생성과 음성/문자 인식에 필요한 모든 로컬 모델(OCR, STT, AI Assist)이 준비되어 있습니다.")
              : missingModels.length > 0
                ? t("다운로드 필요: {p0}. 버튼을 누르면 순서대로 일괄 다운로드합니다.", { p0: missingModels.join(", ") })
                : t("정리본 생성에 필요한 로컬 모델(PDF OCR, Whisper STT, Qwen3)을 한 번에 내려받습니다.")}
          </p>
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {loading ? (
            <Loader2 className="animate-spin text-[var(--muted-foreground)]" size={16} />
          ) : downloading ? (
            <Button disabled size="sm" variant="outline">
              <Loader2 className="mr-1.5 animate-spin" size={14} />
              {t("다운로드 중...")}
            </Button>
          ) : !status || allReady ? (
            <Button
              aria-label={t("모델 상태 새로고침")}
              onClick={() => void loadStatus()}
              size="sm"
              variant="outline"
            >
              <RefreshCw className="mr-1.5" size={13} />
              {t("상태 확인")}
            </Button>
          ) : (
            <Button
              onClick={() => void handlePrepare()}
              size="sm"
            >
              <Download className="mr-1.5" size={14} />
              {t("모델 준비")}
            </Button>
          )}
        </div>
      </div>

      {downloading && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3">
          <div className="flex items-center justify-between text-xs text-[var(--foreground)]">
            <span>{stageTitle}</span>
            {progress && (
              <span className="tabular-nums text-[var(--muted-foreground)]">
                {progress.percent}% ({formatBytes(progress.completed)} / {formatBytes(progress.total)})
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--brand)] transition-all duration-300"
              style={{ width: `${progress?.percent ?? (stageTitle ? 100 : 0)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
