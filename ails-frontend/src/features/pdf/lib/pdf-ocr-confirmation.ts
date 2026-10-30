import type { PdfOcrStatus } from "../../../lib/api"

type OcrTextStatus = Pick<PdfOcrStatus,
  "has_text" | "needs_ocr" | "ocr_allowed" | "ocr_scope" | "ocr_embedded" | "indexed" | "index_repair_required"
>

export type PdfOcrConfirmationTextState = "checking" | "repair" | "textless_slides" | "existing_text" | "missing_text"

export function shouldAutomaticallyPromptPdfOcr(status: OcrTextStatus): boolean {
  if (!status.needs_ocr || status.ocr_allowed === false) return false
  // An old OCR configuration does not mean the document has lost its text.
  const needsIndexRepair = status.index_repair_required || (status.ocr_embedded && !status.indexed)
  return status.ocr_scope === "textless_slides" || !status.has_text || Boolean(needsIndexRepair)
}

export function pdfOcrConfirmationTextState(status: OcrTextStatus | null | undefined): PdfOcrConfirmationTextState {
  if (!status) return "checking"
  if (status.index_repair_required || (status.ocr_embedded && !status.indexed)) return "repair"
  if (status.has_text && status.ocr_scope === "textless_slides") return "textless_slides"
  return status.has_text ? "existing_text" : "missing_text"
}
