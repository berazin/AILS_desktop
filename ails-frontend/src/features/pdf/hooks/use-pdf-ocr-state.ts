import { useRef, useState } from 'react'
import { t } from '../../../lib/i18n.ts'
import type { PdfOcrPerformanceProfileStatus, PdfOcrStatus } from '../../../lib/api'
import type { PdfOcrFolderConfirmation } from '../components/pdf-ocr-folder-confirm-dialog.tsx'
import type { PdfOcrDragSelection, PdfOcrJob, PdfOcrPerformance, PdfOcrProgress } from '../lib/pdf-controller-types.ts'

// This hook owns ocr state; other PDF domains interact through its returned contract.
export function usePdfOcrState() {
  const [pdfOcrSelection, setPdfOcrSelection] = useState<PdfOcrDragSelection | null>(null)
  const [isPdfRegionOcrBusy, setIsPdfRegionOcrBusy] = useState(false)
  const [pdfFullOcrStatus, setPdfFullOcrStatus] = useState<PdfOcrStatus | null>(null)
  const [pdfFullOcrProgress, setPdfFullOcrProgress] = useState<PdfOcrProgress | null>(null)
  const [pdfOcrJobs, setPdfOcrJobs] = useState<PdfOcrJob[]>([])
  const [pdfOcrPhase, setPdfOcrPhase] = useState(t("OCR 준비 중"))
  const [pdfOcrPerformance, setPdfOcrPerformance] = useState<PdfOcrPerformance | null>(null)
  const [pdfOcrBenchmarkProgress, setPdfOcrBenchmarkProgress] = useState<{
    candidate: number
    candidateTotal: number
    repeat: number
    repeatTotal: number
    modelIndex: number
    modelTotal: number
    modelVariant: "tiny" | "small" | "medium"
  } | null>(null)
  const [pdfOcrBenchmarkError, setPdfOcrBenchmarkError] = useState("")
  const [pdfOcrCancelPending, setPdfOcrCancelPending] = useState(false)
  const [pdfOcrSavedProfile, setPdfOcrSavedProfile] = useState<PdfOcrPerformanceProfileStatus | null>(null)
  const [pdfOcrSavedProfileLoading, setPdfOcrSavedProfileLoading] = useState(false)
  const [pdfOcrSettingsActive, setPdfOcrSettingsActive] = useState(false)
  const [pdfOcrSavedProfileError, setPdfOcrSavedProfileError] = useState("")
  const [pdfOcrModelDownloadProgress, setPdfOcrModelDownloadProgress] = useState<{
    completedBytes: number
    totalBytes: number
  } | null>(null)
  const [pdfOcrError, setPdfOcrError] = useState("")
  const [pdfOcrConfirmPath, setPdfOcrConfirmPath] = useState("")
  const [pdfOcrForceRerun, setPdfOcrForceRerun] = useState(false)
  const [pdfOcrFolderConfirm, setPdfOcrFolderConfirm] = useState<PdfOcrFolderConfirmation | null>(null)
  const [isPdfOcrHintDismissed, setIsPdfOcrHintDismissed] = useState(
    () => localStorage.getItem("ails_pdf_ocr_hint_dismissed") === "true",
  )
  const [codeSandboxOcrInsertRequest, setCodeSandboxOcrInsertRequest] = useState<{
    id: number
    text: string
    page: number
  } | null>(null)
  const pdfOcrSelectionRef = useRef<PdfOcrDragSelection | null>(null)
  const pdfOcrDidDragRef = useRef(false)
  const pdfSuppressNextClickRef = useRef(false)
  const pdfRegionOcrAbortRef = useRef<AbortController | null>(null)
  const pdfFullOcrAbortRef = useRef<AbortController | null>(null)
  const pdfFullOcrJobIdRef = useRef("")
  const pdfOcrControllersRef = useRef<Map<string, AbortController>>(new Map())
  const pdfOcrJobIdsByPathRef = useRef<Map<string, string>>(new Map())
  const pdfOcrModelDownloadAbortRef = useRef<AbortController | null>(null)
  const pdfOcrBenchmarkAbortRef = useRef<AbortController | null>(null)
  const pdfOcrBenchmarkJobIdRef = useRef("")
  const pdfSettingsLoadAbortRef = useRef<AbortController | null>(null)
  const pdfTextExtractionAbortRef = useRef<AbortController | null>(null)
  const pdfOcrPromptedPathRef = useRef("")
  const pdfOcrRequestIdRef = useRef(0)

  return {
    codeSandboxOcrInsertRequest, isPdfOcrHintDismissed, isPdfRegionOcrBusy, pdfFullOcrAbortRef,
    pdfFullOcrJobIdRef, pdfFullOcrProgress, pdfFullOcrStatus, pdfOcrBenchmarkAbortRef,
    pdfOcrBenchmarkError, pdfOcrBenchmarkJobIdRef, pdfOcrBenchmarkProgress, pdfOcrCancelPending,
    pdfOcrConfirmPath, pdfOcrControllersRef, pdfOcrDidDragRef, pdfOcrError, pdfOcrFolderConfirm,
    pdfOcrForceRerun, pdfOcrJobIdsByPathRef, pdfOcrJobs, pdfOcrModelDownloadAbortRef,
    pdfOcrModelDownloadProgress, pdfOcrPerformance, pdfOcrPhase, pdfOcrPromptedPathRef,
    pdfOcrSettingsActive, setPdfOcrSettingsActive,
    pdfOcrRequestIdRef, pdfOcrSavedProfile, pdfOcrSavedProfileError, pdfOcrSavedProfileLoading,
    pdfOcrSelection, pdfOcrSelectionRef, pdfRegionOcrAbortRef, pdfSettingsLoadAbortRef,
    pdfSuppressNextClickRef, pdfTextExtractionAbortRef, setCodeSandboxOcrInsertRequest,
    setIsPdfOcrHintDismissed, setIsPdfRegionOcrBusy, setPdfFullOcrProgress, setPdfFullOcrStatus,
    setPdfOcrBenchmarkError, setPdfOcrBenchmarkProgress, setPdfOcrCancelPending,
    setPdfOcrConfirmPath, setPdfOcrError, setPdfOcrFolderConfirm, setPdfOcrForceRerun,
    setPdfOcrJobs, setPdfOcrModelDownloadProgress, setPdfOcrPerformance, setPdfOcrPhase,
    setPdfOcrSavedProfile, setPdfOcrSavedProfileError, setPdfOcrSavedProfileLoading,
    setPdfOcrSelection,
  }
}
