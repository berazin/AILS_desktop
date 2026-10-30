import { useCallback, useEffect, useMemo } from "react"

import { waitForInitialDocument } from '../../../lib/initial-document-readiness.ts'
import {
  downloadVoiceAgentModelStream,
  getPdfOcrStatus,
  getPdfProblems,
  scanPdfProblems,
  startPdfProblemAutoReview,
  type AILSConfig,
  type PdfProblem,
  type WorkPreflight,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import {
  pdfProblemsOnPage,
  pdfProblemsSpanningPage,
  readLastPracticeProblem,
  writeLastPracticeProblem,
} from "../../../lib/problem-study.ts"
import type { PdfController } from "./use-pdf-controller.ts"

const PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES = new Set(["queued", "running", "cancel_pending"])

type UsePdfProblemWorkflowsOptions = {
  pdf: PdfController
  document: {
    activePath: string
    activeSourceKey: string
    baseDir: string
    codingModeActive: boolean
    currentPage: number
    goToPage: (page: number) => void
    ocrStatusMatchesActivePath: boolean
  }
  configuration: {
    localProblemReviewModel?: AILSConfig["local_problem_review_model"]
  }
  interaction: {
    confirmWorkPreflight: (
      operation: "pdf_problem_review",
      payload: Record<string, unknown>,
    ) => Promise<false | WorkPreflight | null>
    setNotice: (message: string) => void
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function usePdfProblemWorkflows({
  pdf,
  document,
  configuration,
  interaction,
}: UsePdfProblemWorkflowsOptions) {
  const {
    ocr: { pdfFullOcrStatus, setPdfFullOcrStatus },
    study: {
      openPracticeForProblemRef, pdfProblemAnalysisAbortRef, pdfProblemAnalysisPendingKey,
      pdfProblemAutoReviewPollRef, pdfProblemAutoReviewStatus, pdfProblems,
      pdfProblemsAnalyzing, pdfProblemsLoadAbortRef, pdfProblemsLoading, pdfProblemsSourceKey,
      practiceInitialSelectionKeyRef, selectedPdfProblemId, setPdfProblemAnalysisPendingKey,
      setPdfProblemAutoReviewError, setPdfProblemAutoReviewStatus, setPdfProblems,
      setPdfProblemsAnalyzing, setPdfProblemsError, setPdfProblemsLoading,
      setPdfProblemsSourceKey, setSelectedPdfProblemId,
    },
  } = pdf
  const {
    activePath,
    activeSourceKey,
    baseDir,
    codingModeActive,
    currentPage,
    goToPage,
    ocrStatusMatchesActivePath,
  } = document
  const localProblemReviewModel = configuration.localProblemReviewModel ?? "auto"
  const { confirmWorkPreflight, setNotice } = interaction

  const activePdfProblems = useMemo(
    () => pdfProblemsSourceKey === activeSourceKey ? pdfProblems : [],
    [activeSourceKey, pdfProblems, pdfProblemsSourceKey],
  )

  useEffect(() => {
    pdfProblemAnalysisAbortRef.current?.abort()
    pdfProblemAnalysisAbortRef.current = null
    setSelectedPdfProblemId("")
    setPdfProblemsSourceKey("")
    setPdfProblemAnalysisPendingKey("")
    if (!activePath || !baseDir) {
      setPdfProblems([])
      setPdfProblemsLoading(false)
      setPdfProblemsAnalyzing(false)
      setPdfProblemsError("")
      return
    }
    const controller = new AbortController()
    pdfProblemsLoadAbortRef.current?.abort()
    pdfProblemsLoadAbortRef.current = controller
    setPdfProblems([])
    setPdfProblemsLoading(true)
    setPdfProblemsAnalyzing(false)
    setPdfProblemsError("")
    void (async () => {
      try {
        await waitForInitialDocument(controller.signal)
        const result = await getPdfProblems(activePath, baseDir, controller.signal)
        if (controller.signal.aborted) return
        const loadedProblems = Array.isArray(result.problems) ? result.problems : []
        const hasDisplayableStaleCatalog = result.analysis_source === "stale" && loadedProblems.length > 0
        if (
          result.scanned !== false
          || result.analysis_source === "saved"
          || hasDisplayableStaleCatalog
        ) {
          setPdfProblems(loadedProblems)
          setPdfProblemsSourceKey(activeSourceKey)
        }
        if (result.scanned === false) setPdfProblemAnalysisPendingKey(activeSourceKey)
      } catch (error) {
        if (!controller.signal.aborted) {
          setPdfProblems([])
          setPdfProblemsSourceKey("")
          setPdfProblemsError(getErrorMessage(error))
          console.warn("Failed to load PDF problems", error)
        }
      } finally {
        if (!controller.signal.aborted) {
          setPdfProblemsLoading(false)
          setPdfProblemsAnalyzing(false)
        }
      }
    })()
    return () => {
      controller.abort()
      if (pdfProblemsLoadAbortRef.current === controller) pdfProblemsLoadAbortRef.current = null
    }
  }, [
    activePath,
    activeSourceKey,
    baseDir,
    pdfProblemAnalysisAbortRef,
    pdfProblemsLoadAbortRef,
    setPdfProblemAnalysisPendingKey,
    setPdfProblems,
    setPdfProblemsAnalyzing,
    setPdfProblemsError,
    setPdfProblemsLoading,
    setPdfProblemsSourceKey,
    setSelectedPdfProblemId,
  ])

  const currentPdfProblems = useMemo(
    () => pdfProblemsOnPage(activePdfProblems, currentPage),
    [activePdfProblems, currentPage],
  )

  const handleStartPdfProblemReview = useCallback(async (
    reviewQueueOnly: boolean,
    page?: number,
    reviewEngine: "local" | "cloud" = "cloud",
  ) => {
    if (!activePath || !baseDir || pdfProblemsAnalyzing) return
    if (PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES.has(pdfProblemAutoReviewStatus?.status ?? "")) return
    const engineLabel = reviewEngine === "local" ? t("로컬 AI") : t("클라우드 AI")
    const label = page
      ? t("{p0} 현재 페이지 검수", { p0: engineLabel })
      : reviewQueueOnly
        ? t("{p0} 검토 문제 검수", { p0: engineLabel })
        : t("{p0} 전체 문제 검수", { p0: engineLabel })
    const targetProblems = page ? currentPdfProblems : activePdfProblems
    if (targetProblems.length === 0) {
      const message = t("검수할 문제가 없습니다. 먼저 문제 분석을 실행해 주세요.")
      setPdfProblemAutoReviewError(message)
      setNotice(message)
      return
    }
    setPdfProblemAutoReviewError("")
    try {
      let ocrStatus = ocrStatusMatchesActivePath ? pdfFullOcrStatus : null
      if (!ocrStatus) {
        ocrStatus = await getPdfOcrStatus(activePath)
        setPdfFullOcrStatus(ocrStatus)
      }
      if (ocrStatus.needs_ocr || !ocrStatus.has_text) {
        throw new Error(t("{p0}는 PDF 전체 OCR 완료 후 사용할 수 있습니다.", { p0: label }))
      }
      const accepted = await confirmWorkPreflight("pdf_problem_review", {
        pdf_path: activePath,
        base_dir: baseDir,
        review_engine: reviewEngine,
        local_problem_review_model: localProblemReviewModel,
        review_queue_only: reviewQueueOnly,
        ...(page ? { page } : {}),
      })
      if (!accepted) return
      if (reviewEngine === "local" && accepted.local_problem_review_model?.download_required) {
        const model = accepted.local_problem_review_model
        await downloadVoiceAgentModelStream((event) => {
          if (event.type !== "model_download") return
          const completed = Number(event.completed_bytes || 0)
          const total = Number(event.total_bytes || model.file_size || 1)
          setNotice(t("{p0} 문제 검수 모델 다운로드 {p1}%", { p0: String(model.model_label || "Qwen3"), p1: Math.min(100, Math.round(completed * 100 / Math.max(1, total))) }))
        }, undefined, { model_id: model.model_id })
      }
      const status = await startPdfProblemAutoReview({
        pdf_path: activePath,
        base_dir: baseDir,
        mode: "production",
        review_engine: reviewEngine,
        local_problem_review_model: localProblemReviewModel,
        review_queue_only: reviewQueueOnly,
        work_acknowledged: true,
        ...(page ? { page } : {}),
        retry_failed: !reviewQueueOnly && Boolean(
          pdfProblemAutoReviewStatus?.budget_unlimited
          && pdfProblemAutoReviewStatus.retry_available
          && ["failed", "completed_with_errors", "interrupted", "stale", "cancelled", "budget_accounting_error"]
            .includes(pdfProblemAutoReviewStatus.status),
        ),
      })
      setPdfProblemAutoReviewStatus(status)
      if (PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES.has(status.status)) {
        pdfProblemAutoReviewPollRef.current?.()
      }
      setNotice(
        status.deduplicated
          ? t("이 PDF catalog revision은 이미 {p0}를 실행했습니다.", { p0: label })
          : t("{p0}를 시작했습니다. 페이지별 진행상태를 표시합니다.", { p0: label }),
      )
    } catch (error) {
      const message = getErrorMessage(error)
      setPdfProblemAutoReviewError(message)
      setNotice(t("{p0} 시작 실패: {p1}", { p0: label, p1: message }))
    }
  }, [
    activePath,
    activePdfProblems,
    baseDir,
    confirmWorkPreflight,
    currentPdfProblems,
    localProblemReviewModel,
    ocrStatusMatchesActivePath,
    pdfFullOcrStatus,
    pdfProblemAutoReviewPollRef,
    pdfProblemAutoReviewStatus,
    pdfProblemsAnalyzing,
    setNotice,
    setPdfFullOcrStatus,
    setPdfProblemAutoReviewError,
    setPdfProblemAutoReviewStatus,
  ])

  const handleReviewAllPdfProblems = useCallback(async () => {
    await handleStartPdfProblemReview(false, undefined, "cloud")
  }, [handleStartPdfProblemReview])

  const handleReviewAllPdfProblemsLocal = useCallback(async () => {
    await handleStartPdfProblemReview(false, undefined, "local")
  }, [handleStartPdfProblemReview])

  const handleReviewQueuedPdfProblems = useCallback(async () => {
    await handleStartPdfProblemReview(true)
  }, [handleStartPdfProblemReview])

  const handleReviewCurrentPdfPage = useCallback(async () => {
    await handleStartPdfProblemReview(false, currentPage)
  }, [currentPage, handleStartPdfProblemReview])

  useEffect(() => {
    if (
      !activePath
      || !baseDir
      || pdfProblemAnalysisPendingKey !== activeSourceKey
      || !ocrStatusMatchesActivePath
    ) return
    if (pdfFullOcrStatus?.needs_ocr || !pdfFullOcrStatus?.has_text) {
      setPdfProblemsLoading(false)
      setPdfProblemsAnalyzing(false)
      return
    }
    const controller = new AbortController()
    setPdfProblemsLoading(true)
    setPdfProblemsAnalyzing(true)
    setPdfProblemsError("")
    void scanPdfProblems({
      pdf_path: activePath,
      base_dir: baseDir,
    }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setPdfProblems(Array.isArray(result.problems) ? result.problems : [])
      setPdfProblemsSourceKey(activeSourceKey)
      setPdfProblemAnalysisPendingKey("")
    }).catch((error) => {
      if (controller.signal.aborted) return
      setPdfProblemsError(getErrorMessage(error))
      console.warn("Failed to analyze PDF problems", error)
    }).finally(() => {
      if (!controller.signal.aborted) {
        setPdfProblemsLoading(false)
        setPdfProblemsAnalyzing(false)
      }
    })
    return () => controller.abort()
  }, [
    activePath,
    activeSourceKey,
    baseDir,
    ocrStatusMatchesActivePath,
    pdfFullOcrStatus?.has_text,
    pdfFullOcrStatus?.needs_ocr,
    pdfProblemAnalysisPendingKey,
    setPdfProblemAnalysisPendingKey,
    setPdfProblems,
    setPdfProblemsAnalyzing,
    setPdfProblemsError,
    setPdfProblemsLoading,
    setPdfProblemsSourceKey,
  ])

  const handleSelectPdfProblem = useCallback((problem: PdfProblem) => {
    setSelectedPdfProblemId(problem.id)
    if (activePath) writeLastPracticeProblem(window.localStorage, activePath, problem.id)
    openPracticeForProblemRef.current(problem)
  }, [activePath, openPracticeForProblemRef, setSelectedPdfProblemId])

  const handleSelectPdfProblemInWorkspace = useCallback((problem: PdfProblem) => {
    setSelectedPdfProblemId(problem.id)
    if (activePath) writeLastPracticeProblem(window.localStorage, activePath, problem.id)
  }, [activePath, setSelectedPdfProblemId])

  useEffect(() => {
    if (!codingModeActive) {
      practiceInitialSelectionKeyRef.current = ""
      return
    }
    if (
      !activeSourceKey
      || pdfProblemsLoading
      || activePdfProblems.length === 0
      || practiceInitialSelectionKeyRef.current === activeSourceKey
    ) return

    practiceInitialSelectionKeyRef.current = activeSourceKey
    if (activePdfProblems.some((problem) => problem.id === selectedPdfProblemId)) return
    const savedProblemId = readLastPracticeProblem(window.localStorage, activePath)
    const initialProblem = activePdfProblems.find((problem) => problem.id === savedProblemId)
      ?? pdfProblemsSpanningPage(activePdfProblems, currentPage)[0]
      ?? activePdfProblems[0]
    if (!initialProblem) return
    setSelectedPdfProblemId(initialProblem.id)
    writeLastPracticeProblem(window.localStorage, activePath, initialProblem.id)
    if (pdfProblemsSpanningPage([initialProblem], currentPage).length === 0) {
      goToPage(initialProblem.page)
    }
  }, [
    activePath,
    activePdfProblems,
    activeSourceKey,
    codingModeActive,
    currentPage,
    goToPage,
    pdfProblemsLoading,
    practiceInitialSelectionKeyRef,
    selectedPdfProblemId,
    setSelectedPdfProblemId,
  ])

  const handlePdfProblemChange = useCallback((nextProblem: PdfProblem) => {
    setPdfProblems((current) => {
      if (!current.some((problem) => problem.id === nextProblem.id)) return current
      return current.map((problem) => problem.id === nextProblem.id ? nextProblem : problem)
    })
  }, [setPdfProblems])

  return {
    activePdfProblems,
    currentPdfProblems,
    handlePdfProblemChange,
    handleReviewAllPdfProblems,
    handleReviewAllPdfProblemsLocal,
    handleReviewCurrentPdfPage,
    handleReviewQueuedPdfProblems,
    handleSelectPdfProblem,
    handleSelectPdfProblemInWorkspace,
  }
}
