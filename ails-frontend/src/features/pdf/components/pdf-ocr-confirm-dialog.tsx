import { FileText, Gauge, Loader2 } from "lucide-react"

import type { PdfOcrPerformanceProfileStatus } from "../../../lib/api"
import type { PdfOcrConfirmationTextState } from "../lib/pdf-ocr-confirmation.ts"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

function formatModelDownloadSize(bytes: number) {
  return `${(Math.max(0, bytes) / (1024 * 1024)).toFixed(1)} MiB`
}

export function PdfOcrConfirmDialog({
  confirmDisabled,
  downloadProgress,
  languageLabel,
  localSttEnabled,
  needsIndexRepair,
  ocrError,
  onCancel,
  onConfirm,
  open,
  profile,
  profileError,
  profileLoading,
  rerunsExistingText,
  textState,
}: {
  confirmDisabled: boolean
  downloadProgress: { completedBytes: number; totalBytes: number } | null
  languageLabel: string
  localSttEnabled: boolean
  needsIndexRepair: boolean
  ocrError: string
  onCancel: () => void
  onConfirm: () => void
  open: boolean
  profile: PdfOcrPerformanceProfileStatus | null
  profileError: string
  profileLoading: boolean
  rerunsExistingText: boolean
  textState: PdfOcrConfirmationTextState
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4" onMouseDown={onCancel}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("PDF 전체 OCR")}
        className="max-h-[calc(100vh-32px)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[var(--brand)]/15 p-2 text-[var(--brand)]"><FileText size={20} /></div>
          <div>
            <h2 className="text-base font-bold text-[var(--foreground)]">{t("PDF 전체 OCR")}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {textState === "checking"
                ? t("PDF 텍스트 레이어를 확인하는 중입니다.")
                : textState === "textless_slides"
                  ? t("일부 슬라이드에 텍스트 레이어가 없습니다. 텍스트가 없는 슬라이드만 OCR할까요?")
                  : rerunsExistingText
                    ? t("이 PDF에는 이미 검색 가능한 텍스트 레이어가 있습니다. {p0} 전체 OCR을 다시 실행할까요?", { p0: languageLabel })
                    : needsIndexRepair
                      ? t("기존 OCR 검색 색인이 손상되었습니다. {p0} 전체 OCR로 복구할까요?", { p0: languageLabel })
                      : t("이 PDF에는 검색 가능한 텍스트가 없습니다. {p0} 전체 OCR을 실행할까요?", { p0: languageLabel })}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
              {rerunsExistingText
                ? t("완료되면 새 OCR 결과를 PDF와 검색 색인에 저장합니다.")
                : t("완료되면 PDF 자체에 텍스트가 저장되고 목차와 검색을 사용할 수 있습니다.")}
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand)]/10 p-4">
          <Gauge className="mt-0.5 shrink-0 text-[var(--brand)]" size={19} />
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">{t("기기 사양에 맞춰 자동 선택")}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
              {t("CPU, 메모리와 GPU 가속 지원 여부를 확인해 Tiny·Small·Medium 중 안정적으로 실행할 수 있는 모델을 자동으로 선택합니다.")}
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-black/5 px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)] dark:bg-white/5">
          <p>{t("선택된 PP-OCRv6 검출 모델과 실제 운용 사양은 OCR 진행 화면에 표시됩니다.")}</p>
          <p className="mt-1">
            {t("OCR은 자동 선택된 PP-OCRv6 검출 모델과 설정 언어(Language)에 맞는 PP-OCRv5 인식 모델을 함께 사용합니다. 모델 자동 비교는 한국어만 지원합니다.")}
          </p>
          <p className="mt-1">
            {t("Windows 10/11 64비트, DirectML 호환 NVIDIA·AMD·Intel GPU, 최신 그래픽 드라이버와 충분한 SSD 여유 공간을 권장합니다.")}
            {localSttEnabled ? t(" 로컬 STT 모델은 패키지에 포함됩니다.") : ""}
          </p>
        </div>
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-black/5 px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)] dark:bg-white/5">
          <p className="font-semibold text-[var(--foreground)]">
            {rerunsExistingText
              ? t("사용자가 요청한 재실행이므로 기존 텍스트 레이어가 있어도 OCR을 진행합니다.")
              : t("OCR 실행 직전에 텍스트 레이어를 다시 확인합니다.")}
          </p>
          <p className="mt-1">
            {rerunsExistingText
              ? t("완료 전에는 원본 PDF를 변경하지 않고, 전체 처리가 끝나면 새 결과를 저장합니다.")
              : t("검색 가능한 텍스트가 있으면 PDF를 변경하지 않고 OCR을 건너뜁니다.")}
          </p>
        </div>
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-black/5 px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)] dark:bg-white/5">
          <p>{t("OCR 최적 배치 검사는 이 창에서 실행하지 않습니다. 설정 → PDF OCR에서만 실행할 수 있습니다.")}</p>
          <p className="mt-1">{t("설정에 저장된 측정값이 있으면 OCR 실행 시 자동으로 적용하고, 없으면 안전한 기본값으로 시작합니다.")}</p>
        </div>
        {profileLoading && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-black/5 px-3 py-2.5 dark:bg-white/5">
            <Loader2 className="shrink-0 animate-spin text-[var(--muted-foreground)]" size={17} />
            <div className="text-xs text-[var(--muted-foreground)]">{t("OCR 실행 환경을 확인하는 중입니다.")}</div>
          </div>
        )}
        {profileError && !profileLoading && (
          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-500">
            {t("OCR 실행 환경을 확인하지 못했습니다: ")}{profileError}
          </div>
        )}
        {profile?.dependencies && !profileLoading && !profile.dependencies.ready && (
          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-500">
            <div className="font-semibold">{t("OCR 실행 구성요소가 없습니다.")}</div>
            <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t("누락: ")}{profile.dependencies.missing.join("·")}</div>
            <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t("실행 코드와 DLL은 외부에서 다운로드하지 않습니다. AILS를 다시 설치하거나 업데이트해 주세요.")}</div>
          </div>
        )}
        {profile?.dependencies.ready && profile.model.managed && !profile.model.ready && !profileLoading && (
          <div className="mt-3 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/10 px-3 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
            <div className="font-semibold text-[var(--foreground)]">{t("이 기능을 사용하려면 AI 모델을 추가로 다운로드해야 합니다.")}</div>
            <div className="mt-1">{t("다운로드 크기: ")}{formatModelDownloadSize(profile.model.file_size)}</div>
            <div>{t("저장 위치: Windows 사용자 앱 데이터 · 라이선스: ")}{profile.model.license || t("확인 필요")}</div>
          </div>
        )}
        {downloadProgress && (
          <div className="mt-3 rounded-lg border border-[var(--border)] bg-black/5 px-3 py-3 dark:bg-white/5">
            <div className="flex items-center justify-between gap-3 text-xs text-[var(--muted-foreground)]">
              <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> {t("AI 모델 다운로드 중")}</span>
              <span className="tabular-nums">
                {formatModelDownloadSize(downloadProgress.completedBytes)} / {formatModelDownloadSize(downloadProgress.totalBytes)}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-150"
                style={{ width: `${Math.min(100, (downloadProgress.completedBytes / Math.max(1, downloadProgress.totalBytes)) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {profile?.dependencies?.ready && profile.state === "unavailable" && profile.cpu_available && !profileLoading && (
          <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-500">
            <div className="font-semibold">{t("GPU 가속을 사용할 수 없어 CPU로 실행합니다.")}</div>
            <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t("CPU에서는 처리 시간이 오래 걸릴 수 있습니다.")}</div>
          </div>
        )}
        {ocrError && !downloadProgress && (
          <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-400">{ocrError}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} variant="ghost">{t("취소")}</Button>
          <Button disabled={confirmDisabled || textState === "checking"} onClick={onConfirm}>
            {downloadProgress ? <Loader2 className="animate-spin" size={15} /> : null}
            {profile?.model?.ready
              ? rerunsExistingText ? t("OCR 다시 실행") : t("OCR 확인")
              : t("다운로드")}
          </Button>
        </div>
      </section>
    </div>
  )
}
