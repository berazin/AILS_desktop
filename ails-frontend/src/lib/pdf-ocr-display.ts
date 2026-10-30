import type { PdfOcrModelVariant } from "./api"
import { t } from "./i18n.ts"

export const PDF_OCR_MODEL_LABELS: Record<PdfOcrModelVariant, string> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
}

export const PDF_OCR_MODEL_SELECTION_REASONS: Record<string, string> = {
  matching_numbers_speed_within_5_percent: t("문제번호가 같아 속도 차이 5% 이내에서 더 정밀한 모델을 선택"),
  number_disagreement_most_detected: t("문제번호 검출량이 달라 숫자를 가장 많이 보존한 모델을 선택"),
}

export function pdfOcrProviderLabel(provider: string) {
  if (provider === "DmlExecutionProvider") return "DirectML GPU"
  if (provider === "CUDAExecutionProvider") return "CUDA GPU"
  if (provider === "CPUExecutionProvider" || provider === "CPU") return "CPU"
  return provider || t("알 수 없는 장치")
}

export function formatPdfOcrMeasuredAt(value: string) {
  if (!value) return ""
  const measuredAt = new Date(value)
  if (Number.isNaN(measuredAt.getTime())) return value
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(measuredAt)
}
