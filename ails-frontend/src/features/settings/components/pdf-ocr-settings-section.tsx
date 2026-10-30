import { Gauge, Loader2 } from "lucide-react"
import { useEffect } from "react"

import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import type { PdfOcrModelVariant } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import {
  formatPdfOcrMeasuredAt,
  PDF_OCR_MODEL_LABELS,
  PDF_OCR_MODEL_SELECTION_REASONS,
  pdfOcrProviderLabel,
} from "../../../lib/pdf-ocr-display.ts"
import { Button } from "../../../shared/ui/button.tsx"

export function PdfOcrSettingsSection({
  active,
  normalizeModelVariant,
  ocr,
  onBenchmark,
}: {
  active: boolean
  normalizeModelVariant: (value: unknown) => PdfOcrModelVariant
  ocr: PdfController["ocr"]
  onBenchmark: () => void | Promise<void>
}) {
  const {
    pdfOcrBenchmarkError,
    pdfOcrBenchmarkProgress,
    pdfOcrCancelPending,
    pdfOcrSavedProfile,
    pdfOcrSavedProfileLoading,
    setPdfOcrSettingsActive,
  } = ocr

  useEffect(() => {
    setPdfOcrSettingsActive(active)
    return () => setPdfOcrSettingsActive(false)
  }, [active, setPdfOcrSettingsActive])

  return (
    <section
      className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5"
      hidden={!active}
      id="settings-pdf-ocr"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("PDF OCR 모델·배치")}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
            {t("이 설정에서 Tiny·Small·Medium을 같은 페이지로 비교합니다. 누락된 모델은 버튼을 누르면 내려받고, 선택 결과는 다음 OCR에 자동 적용됩니다. 모델·배치 자동 비교는 한국어 OCR만 지원합니다.")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={Boolean(
            pdfOcrCancelPending
            || (!pdfOcrBenchmarkProgress && (
              pdfOcrSavedProfileLoading
              || !pdfOcrSavedProfile
              || pdfOcrSavedProfile.state === "unavailable"
            )),
          )}
          onClick={() => void onBenchmark()}
        >
          {pdfOcrBenchmarkProgress ? <Loader2 className="animate-spin" size={14} /> : <Gauge size={14} />}
          {pdfOcrBenchmarkProgress ? t("중단") : t("모델·배치 검사")}
        </Button>
      </div>
      <div className="mt-3 rounded-lg bg-black/5 px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)] dark:bg-white/5">
        {t("대상 PDF: AILS 내장 이미지형 9페이지 테스트 문서")}
        <div className="mt-1">
          {t("세 모델을 같은 표본 페이지에서 각 3회 실행합니다. 문제번호 보존을 우선하고, 결과가 같으면 처리 속도를 비교합니다. 검사 중에는 OCR을 시작할 수 없습니다.")}
        </div>
      </div>
      {pdfOcrSavedProfileLoading && (
        <div className="mt-3 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Loader2 className="animate-spin" size={14} /> {t("OCR 실행 환경을 확인하는 중입니다.")}
        </div>
      )}
      {pdfOcrSavedProfile?.dependencies && !pdfOcrSavedProfile.dependencies.ready && !pdfOcrSavedProfileLoading && (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          {t("OCR 실행 구성요소가 없습니다: ")}{(pdfOcrSavedProfile.dependencies.missing ?? []).join("·")}{t(". AILS를 다시 설치하거나 업데이트해 주세요.")}
        </div>
      )}
      {pdfOcrSavedProfile?.dependencies.ready && pdfOcrSavedProfile.model.managed && !pdfOcrSavedProfile.model.ready && !pdfOcrSavedProfileLoading && (
        <div className="mt-3 rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/10 px-3 py-2 text-xs text-[var(--muted-foreground)]">
          {t("현재 자동 선택된 ")}{PDF_OCR_MODEL_LABELS[normalizeModelVariant(pdfOcrSavedProfile.model_variant)]} {t("모델이 없습니다. OCR 실행 창에서 이 모델만 받거나, 모델·배치 검사에서 누락된 세 모델을 확인 후 받을 수 있습니다.")}
        </div>
      )}
      {pdfOcrSavedProfile?.measurement && !pdfOcrSavedProfileLoading && (
        <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] leading-5 text-[var(--muted-foreground)]">
          <div className="text-xs font-semibold text-[var(--foreground)]">{t("저장된 V6 권장 모델·배치")}</div>
          <div>{t("권장 모델: ")}{PDF_OCR_MODEL_LABELS[normalizeModelVariant(pdfOcrSavedProfile.model_variant)]}</div>
          <div>{pdfOcrSavedProfile.detection_model} · {pdfOcrSavedProfile.recognition_model} · {pdfOcrProviderLabel(pdfOcrSavedProfile.gpu_provider)}</div>
          <div className="tabular-nums">
            {t("렌더 ")}{pdfOcrSavedProfile.measurement.effective_batch_pages}{t("p · 검출 ")}{pdfOcrSavedProfile.measurement.detector_batch}{t("p · 인식 ")}{pdfOcrSavedProfile.measurement.recognition_batch}{t("줄 · 배율 ×")}{Number(pdfOcrSavedProfile.render_scale || 1).toFixed(2)}
          </div>
          <div>{formatPdfOcrMeasuredAt(pdfOcrSavedProfile.measurement.measured_at)}{pdfOcrSavedProfile.applied ? t(" · 현재 적용") : t(" · 현재 미적용")}</div>
          {pdfOcrSavedProfile.model_selection && (
            <>
              <div>{PDF_OCR_MODEL_SELECTION_REASONS[pdfOcrSavedProfile.model_selection.reason] || t("모델 비교 결과를 적용")}</div>
              <div className="flex flex-wrap gap-x-3 tabular-nums">
                {(pdfOcrSavedProfile.model_selection.candidates ?? []).map((candidate) => (
                  <span key={candidate.model_variant}>
                    {PDF_OCR_MODEL_LABELS[normalizeModelVariant(candidate.model_variant)]}: {candidate.ok && candidate.seconds_per_page != null
                      ? t("{p0}초/쪽 · 숫자 {p1}개", { p0: candidate.seconds_per_page.toFixed(2), p1: candidate.number_count ?? 0 })
                      : t("검사 실패")}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {pdfOcrSavedProfile?.state === "missing" && !pdfOcrSavedProfileLoading && (
        <div className="mt-3 text-xs text-[var(--muted-foreground)]">{t("저장된 측정값이 없어 안전 기본값으로 실행합니다.")}</div>
      )}
      {pdfOcrSavedProfile?.state === "incompatible" && !pdfOcrSavedProfileLoading && (
        <div className="mt-3 text-xs text-amber-500">{t("이전 측정값은 현재 V6 설정과 맞지 않아 적용하지 않습니다. 다시 검사해 주세요.")}</div>
      )}
      {pdfOcrBenchmarkProgress && (
        <div className="mt-3 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-xs text-[var(--muted-foreground)]">
          {PDF_OCR_MODEL_LABELS[pdfOcrBenchmarkProgress.modelVariant]} {pdfOcrBenchmarkProgress.modelIndex}/{pdfOcrBenchmarkProgress.modelTotal} {t("· 후보 ")}{pdfOcrBenchmarkProgress.candidate}/{pdfOcrBenchmarkProgress.candidateTotal} {t("· 반복 ")}{pdfOcrBenchmarkProgress.repeat}/{pdfOcrBenchmarkProgress.repeatTotal}
        </div>
      )}
      {pdfOcrBenchmarkError && !pdfOcrBenchmarkProgress && (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-400">{t("모델·배치 검사 실패: ")}{pdfOcrBenchmarkError}</div>
      )}
    </section>
  )
}
