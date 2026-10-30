import { useCallback, useRef, useState } from 'react'
import type { PdfBookmark, PdfDocumentMeta, PdfProblem, PdfProblemAutoReviewStatus } from '../../../lib/api'

// This hook owns study state; other PDF domains interact through its returned contract.
export function usePdfStudyState() {
  const [pdfBookmarks, setPdfBookmarks] = useState<PdfBookmark[]>([])
  const activePdfBookmarksPathRef = useRef("")
  const [pdfDocumentMetas, setPdfDocumentMetas] = useState<PdfDocumentMeta[]>([])
  const [pdfProblems, setPdfProblems] = useState<PdfProblem[]>([])
  const [pdfProblemsSourceKey, setPdfProblemsSourceKey] = useState("")
  const [selectedPdfProblemId, setSelectedPdfProblemId] = useState("")
  const [pdfProblemsLoading, setPdfProblemsLoading] = useState(false)
  const [pdfProblemsAnalyzing, setPdfProblemsAnalyzing] = useState(false)
  const [pdfProblemAnalysisPendingKey, setPdfProblemAnalysisPendingKey] = useState("")
  const [pdfProblemsError, setPdfProblemsError] = useState("")
  const [pdfProblemAutoReviewStatus, setPdfProblemAutoReviewStatus] = useState<PdfProblemAutoReviewStatus | null>(null)
  const [pdfProblemAutoReviewError, setPdfProblemAutoReviewError] = useState("")
  const pdfProblemAutoReviewTerminalRefreshRef = useRef("")
  const pdfProblemAutoReviewPollRef = useRef<(() => void) | null>(null)
  const openPracticeForProblemRef = useRef<(problem: PdfProblem) => void>(() => undefined)
  const setOpenPracticeForProblem = useCallback((handler: (problem: PdfProblem) => void) => {
    openPracticeForProblemRef.current = handler
  }, [])
  const practiceInitialSelectionKeyRef = useRef("")
  const pdfProblemAnalysisAbortRef = useRef<AbortController | null>(null)
  const pdfProblemsLoadAbortRef = useRef<AbortController | null>(null)

  return {
    activePdfBookmarksPathRef, openPracticeForProblemRef, pdfBookmarks, pdfDocumentMetas,
    pdfProblemAnalysisAbortRef, pdfProblemAnalysisPendingKey, pdfProblemAutoReviewError,
    pdfProblemAutoReviewPollRef, pdfProblemAutoReviewStatus, pdfProblemAutoReviewTerminalRefreshRef,
    pdfProblems, pdfProblemsAnalyzing, pdfProblemsError, pdfProblemsLoadAbortRef, pdfProblemsLoading,
    pdfProblemsSourceKey, practiceInitialSelectionKeyRef, selectedPdfProblemId, setOpenPracticeForProblem, setPdfBookmarks,
    setPdfDocumentMetas, setPdfProblemAnalysisPendingKey, setPdfProblemAutoReviewError,
    setPdfProblemAutoReviewStatus, setPdfProblems, setPdfProblemsAnalyzing, setPdfProblemsError,
    setPdfProblemsLoading, setPdfProblemsSourceKey, setSelectedPdfProblemId,
  }
}
