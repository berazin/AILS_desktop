import { useCallback, useEffect } from "react"
import { waitForInitialDocument } from '../../../lib/initial-document-readiness.ts'

import {
  cancelPdfProblemAutoReview,
  getPdfProblemAutoReviewStatus,
  getPdfProblems,
} from "../../../lib/api"
import type { PdfController } from "./use-pdf-controller.ts"

const PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES = new Set(["queued", "running", "cancel_pending"])

type UsePdfProblemAutoReviewWorkflowOptions = {
  pdf: PdfController
  document: {
    activePath: string
    activeSourceKey: string
    baseDir: string
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

export function usePdfProblemAutoReviewWorkflow({
  pdf,
  document,
}: UsePdfProblemAutoReviewWorkflowOptions) {
  const {
    study: {
      pdfProblemAutoReviewPollRef,
      pdfProblemAutoReviewStatus,
      pdfProblemAutoReviewTerminalRefreshRef,
      setPdfProblemAutoReviewError,
      setPdfProblemAutoReviewStatus,
      setPdfProblems,
      setPdfProblemsSourceKey,
    },
  } = pdf
  const {
    activePath: activePdfPath,
    activeSourceKey: activePdfProblemSourceKey,
    baseDir: pdfProblemBaseDir,
  } = document

  useEffect(() => {
    setPdfProblemAutoReviewError("")
    setPdfProblemAutoReviewStatus(null)
    if (!activePdfPath || !pdfProblemBaseDir || !activePdfProblemSourceKey) {
      setPdfProblemAutoReviewStatus(null)
      return
    }
    const controller = new AbortController()
    let disposed = false
    let requestPending = false
    let pollingActive = false
    let timer: number | undefined
    const schedulePoll = () => {
      if (disposed || timer !== undefined) return
      pollingActive = true
      timer = window.setTimeout(() => {
        timer = undefined
        void refresh()
      }, 1500)
    }
    const refresh = async () => {
      if (requestPending || disposed) return
      requestPending = true
      try {
        await waitForInitialDocument(controller.signal)
        const status = await getPdfProblemAutoReviewStatus(activePdfPath, pdfProblemBaseDir, controller.signal)
        if (disposed) return
        setPdfProblemAutoReviewStatus(status)
        const terminalJobId = status.job_id && !PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES.has(status.status)
          ? status.job_id
          : ""
        if (terminalJobId && pdfProblemAutoReviewTerminalRefreshRef.current !== terminalJobId) {
          pdfProblemAutoReviewTerminalRefreshRef.current = terminalJobId
          const result = await getPdfProblems(activePdfPath, pdfProblemBaseDir, controller.signal)
          if (!disposed) {
            setPdfProblems(Array.isArray(result.problems) ? result.problems : [])
            setPdfProblemsSourceKey(activePdfProblemSourceKey)
          }
        }
        pollingActive = PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES.has(status.status)
        if (pollingActive) schedulePoll()
      } catch (error) {
        if (!disposed && !isAbortError(error)) {
          console.warn("Failed to read automatic problem review status", error)
          if (pollingActive) schedulePoll()
        }
      } finally {
        requestPending = false
      }
    }
    pdfProblemAutoReviewPollRef.current = schedulePoll
    void refresh()
    return () => {
      disposed = true
      controller.abort()
      if (pdfProblemAutoReviewPollRef.current === schedulePoll) {
        pdfProblemAutoReviewPollRef.current = null
      }
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [
    activePdfPath,
    activePdfProblemSourceKey,
    pdfProblemAutoReviewPollRef,
    pdfProblemAutoReviewTerminalRefreshRef,
    pdfProblemBaseDir,
    setPdfProblemAutoReviewError,
    setPdfProblemAutoReviewStatus,
    setPdfProblems,
    setPdfProblemsSourceKey,
  ])

  const handleCancelPdfProblemAutoReview = useCallback(() => {
    if (!activePdfPath || !pdfProblemBaseDir) return
    void cancelPdfProblemAutoReview({
      pdf_path: activePdfPath,
      base_dir: pdfProblemBaseDir,
    }).then(setPdfProblemAutoReviewStatus).catch((error) => {
      setPdfProblemAutoReviewError(getErrorMessage(error))
    })
  }, [activePdfPath, pdfProblemBaseDir, setPdfProblemAutoReviewError, setPdfProblemAutoReviewStatus])

  return {
    handleCancelPdfProblemAutoReview,
    isPdfProblemAutoReviewActive: Boolean(
      pdfProblemAutoReviewStatus
      && PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES.has(pdfProblemAutoReviewStatus.status),
    ),
  }
}
