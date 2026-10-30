import { t } from "../../../lib/i18n.ts"
import type { PdfOcrStatus } from "../../../lib/api"
import type { MaterialItem } from "../hooks/use-materials-listing.ts"

export type DocumentDetailOcrJob = {
  path: string
  phase: string
  progress: { page: number; total: number }
  cancelPending?: boolean
}

export function formatStudyDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}${t("시간")} ${minutes % 60}${t("분")}`
  if (minutes > 0) return `${minutes}${t("분")}`
  return `${seconds}${t("초")}`
}

export function detailDate(value?: string | number, empty = t("기록 없음")) {
  if (!value) return empty
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : empty
}

export function documentReadingPosition(item: MaterialItem, totalPages: number, sessions = 0) {
  const paginated = ["PDF", "PPT", "PPTX"].includes(item.kind)
  const total = paginated && Number.isFinite(totalPages) && totalPages >= 1 ? Math.floor(totalPages) : null
  const recorded = paginated && Number.isFinite(item.lastPage) && Number(item.lastPage) >= 1
    && (Number(item.lastPage) > 1 || Boolean(item.lastOpenedAt) || sessions > 0)
  const page = recorded ? Math.min(Math.floor(item.lastPage!), total ?? Infinity) : null
  return {
    total, page,
    percent: page !== null && total ? Math.min(100, Math.round(page / total * 100)) : null,
    remaining: page !== null && total ? Math.max(0, total - page) : null,
  }
}

export function documentProcessingLabels(item: MaterialItem, status: PdfOcrStatus | null, loading: boolean, error: string) {
  const unavailable = loading ? t("확인 중…") : error ? t("상태 확인 실패") : t("정보 없음")
  const ocr = status
    ? status.ocr_embedded ? t("OCR 완료") : status.needs_ocr ? t("OCR 필요") : status.has_text ? t("원본 텍스트 있음") : t("텍스트 없음")
    : item.ocrStatus || (item.kind === "PDF" ? unavailable : ["MD", "TXT", "IPYNB", "EPUB", "folder"].includes(item.kind) ? t("해당 없음") : unavailable)
  const indexing = status
    ? status.index_repair_required ? t("색인 복구 필요") : status.indexed ? t("색인됨") : t("미색인")
    : item.kind === "PDF" ? unavailable : t("정보 없음")
  const analysis = status?.analysis
    ? status.analysis.corrupt ? t("분석 결과 읽기 실패")
      : status.analysis.payload_available ? status.analysis.config_stale ? t("분석 결과 있음 · 재분석 필요") : t("분석 결과 있음")
        : t("분석 결과 없음")
    : loading ? t("확인 중…") : error ? t("상태 확인 실패") : t("분석 정보 없음")
  return { ocr, indexing, analysis }
}

export function sameDocumentPath(left: string, right: string) {
  return left.replace(/\\/g, "/").toLowerCase() === right.replace(/\\/g, "/").toLowerCase()
}
