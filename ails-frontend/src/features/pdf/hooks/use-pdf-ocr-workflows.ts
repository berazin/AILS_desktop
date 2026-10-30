import { useEffect, type RefObject } from "react"

import { invalidatePdfOcrTextLayer } from "../components/pdf-ocr-text-layer-data.ts"
import type { MaterialFilePayload, PdfOcrLanguage, PdfOcrModelVariant, PdfOcrPerformanceProfileStatus, WorkPreflightOperation } from "../../../lib/api"
import {
  benchmarkPdfOcrStream,
  cancelPdfOcrJob,
  downloadPdfOcrModelStream,
  getMaterialFolderPdfOcrPreflight,
  getPdfOcrPerformanceProfile,
  getPdfOcrPageCount,
  getPdfOcrStatus,
  getPdfProblemAutoReviewStatus,
  getPdfProblems,
  normalizePdfOcrModelVariant,
  runFullPdfOcrStream,
  runMaterialFolderPdfOcrStream,
  scanPdfProblems,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { PDF_OCR_MODEL_LABELS } from "../../../lib/pdf-ocr-display.ts"
import type { PdfController, PdfOcrJob } from "./use-pdf-controller.ts"
import { normalizedMaterialPath, type MaterialFolderContextTarget } from "../../../lib/material-navigation.ts"
import { shouldAutomaticallyPromptPdfOcr } from "../lib/pdf-ocr-confirmation.ts"

const PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES = new Set(["queued", "running", "cancel_pending"])

type UsePdfOcrWorkflowsOptions = {
  pdf: PdfController
  document: {
    activePath: string
    activePathRef: RefObject<string>
    applyMaterialFile: (file: MaterialFilePayload) => void
    getViewerSource: () => string
  }
  materials: {
    loadFile: (path: string) => Promise<{ file: MaterialFilePayload }>
    refresh: () => Promise<unknown>
  }
  study: {
    activeSourceKeyRef: RefObject<string>
    baseDir: string
  }
  configuration: {
    language: PdfOcrLanguage
  }
  interaction: {
    confirmWorkPreflight: (
      operation: WorkPreflightOperation,
      payload: Record<string, unknown>,
    ) => Promise<unknown>
    setNotice: (message: string) => void
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function titleFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/")
  const fileName = normalized.split("/").pop() ?? ""
  return fileName.replace(/\.[^.]+$/, "")
}

export function usePdfOcrWorkflows({
  pdf,
  document,
  materials,
  study,
  configuration,
  interaction,
}: UsePdfOcrWorkflowsOptions) {
  const {
    ocr: {
      pdfFullOcrAbortRef, pdfFullOcrJobIdRef, pdfFullOcrProgress,
      pdfOcrBenchmarkAbortRef, pdfOcrBenchmarkJobIdRef, pdfOcrBenchmarkProgress,
      pdfOcrCancelPending, pdfOcrConfirmPath, pdfOcrControllersRef, pdfOcrFolderConfirm,
      pdfOcrForceRerun, pdfOcrJobIdsByPathRef, pdfOcrJobs, pdfOcrModelDownloadAbortRef,
      pdfOcrModelDownloadProgress, pdfOcrPromptedPathRef, pdfOcrSavedProfile,
      pdfOcrSavedProfileLoading, pdfOcrSettingsActive, pdfSettingsLoadAbortRef, setPdfFullOcrProgress,
      setPdfFullOcrStatus, setPdfOcrBenchmarkError, setPdfOcrBenchmarkProgress,
      setPdfOcrCancelPending, setPdfOcrConfirmPath, setPdfOcrError, setPdfOcrFolderConfirm,
      setPdfOcrForceRerun, setPdfOcrJobs, setPdfOcrModelDownloadProgress,
      setPdfOcrPerformance, setPdfOcrPhase, setPdfOcrSavedProfile,
      setPdfOcrSavedProfileError, setPdfOcrSavedProfileLoading,
    },
    study: {
      pdfProblemAutoReviewPollRef, setPdfProblemAnalysisPendingKey,
      setPdfProblemAutoReviewError, setPdfProblemAutoReviewStatus, setPdfProblems,
      setPdfProblemsAnalyzing, setPdfProblemsError, setPdfProblemsLoading,
      setPdfProblemsSourceKey,
    },
    view: { setExpandedPdfOutlineSections, setPdfTextToolsOpen },
  } = pdf
  const { activePath, activePathRef, applyMaterialFile, getViewerSource } = document
  const { activeSourceKeyRef, baseDir: pdfProblemBaseDir } = study
  const { language } = configuration
  const { confirmWorkPreflight, setNotice } = interaction

  function findPdfOcrJobForPath(path: string) {
    const pathKey = normalizedMaterialPath(path).toLocaleLowerCase()
    return pdfOcrJobs.find((job) => normalizedMaterialPath(job.path).toLocaleLowerCase() === pathKey)
  }

  function updatePdfOcrJob(jobId: string, updates: Partial<PdfOcrJob>) {
    setPdfOcrJobs((current) => current.map((job) => (
      job.jobId === jobId ? { ...job, ...updates } : job
    )))
  }

  const activePdfOcrJob = findPdfOcrJobForPath(activePath)
  const hasPdfOcrJobs = pdfOcrJobs.length > 0
  const hasAnyPdfOcrWork = Boolean(pdfFullOcrProgress || hasPdfOcrJobs)

  async function refreshPdfAfterOcr(path: string) {
    const pathKey = normalizedMaterialPath(path).toLocaleLowerCase()
    const isStillActive = () => (
      normalizedMaterialPath(activePathRef.current).toLocaleLowerCase() === pathKey
    )
    if (isStillActive() && getViewerSource() === "material") {
      const { file } = await materials.loadFile(path)
      if (isStillActive()) applyMaterialFile(file)
    }
    const status = await getPdfOcrStatus(path)
    if (isStillActive()) setPdfFullOcrStatus(status)
    return status
  }

  async function stopPdfOcrJob(jobId: string) {
    const job = pdfOcrJobs.find((candidate) => candidate.jobId === jobId)
    if (!job || job.cancelPending) return
    updatePdfOcrJob(jobId, { cancelPending: true, phase: t("OCR 중단 중") })
    try {
      await cancelPdfOcrJob(jobId)
      pdfOcrControllersRef.current.get(jobId)?.abort()
      setNotice(t("{p0} OCR을 중단했습니다.", { p0: job.title }))
    } catch (error) {
      setNotice(t("PDF OCR 중단 실패: {p0}", { p0: getErrorMessage(error) }))
    } finally {
      updatePdfOcrJob(jobId, { cancelPending: false })
    }
  }

  async function stopFullPdfOcr() {
    const jobId = pdfFullOcrJobIdRef.current
    if (!jobId || pdfOcrCancelPending) return
    setPdfOcrCancelPending(true)
    setPdfOcrPhase(t("OCR 중단 중"))
    try {
      const result = await cancelPdfOcrJob(jobId)
      if (result.cancelled) {
        pdfFullOcrAbortRef.current?.abort()
        setNotice(t("PDF OCR을 중단했습니다."))
      }
    } catch (error) {
      setNotice(t("PDF OCR 중단 실패: {p0}", { p0: getErrorMessage(error) }))
    } finally {
      setPdfOcrCancelPending(false)
    }
  }

  async function stopBenchmarkPdfOcr() {
    const jobId = pdfOcrBenchmarkJobIdRef.current
    if (!jobId || pdfOcrCancelPending) return
    setPdfOcrCancelPending(true)
    setPdfOcrPhase(t("최적 배치 검사 중단 중"))
    try {
      const result = await cancelPdfOcrJob(jobId)
      if (result.cancelled) {
        pdfOcrBenchmarkAbortRef.current?.abort()
        setNotice(t("OCR 최적 배치 검사를 중단했습니다."))
      }
    } catch (error) {
      setNotice(t("OCR 최적 배치 검사 중단 실패: {p0}", { p0: getErrorMessage(error) }))
    } finally {
      setPdfOcrCancelPending(false)
    }
  }

  async function handleBenchmarkPdfOcr() {
    if (pdfOcrBenchmarkProgress) {
      await stopBenchmarkPdfOcr()
      return
    }
    if (
      pdfOcrSavedProfileLoading
      || !pdfOcrSavedProfile
      || pdfOcrSavedProfile.state === "unavailable"
      || hasAnyPdfOcrWork
    ) return

    const controller = new AbortController()
    const jobId = crypto.randomUUID()
    pdfOcrBenchmarkAbortRef.current?.abort()
    pdfOcrBenchmarkAbortRef.current = controller
    pdfOcrBenchmarkJobIdRef.current = jobId
    setPdfOcrBenchmarkError("")
    setPdfOcrBenchmarkProgress({
      candidate: 0,
      candidateTotal: 1,
      repeat: 0,
      repeatTotal: 3,
      modelIndex: 0,
      modelTotal: 3,
      modelVariant: "tiny",
    })
    setPdfOcrPhase(t("OCR 모델·배치 검사 준비 중"))
    setNotice(t("Tiny·Small·Medium 모델과 배치를 비교하는 중입니다."))

    let measured: {
      batchPages: number
      detectorBatch: number
      recognitionBatch: number
      gpuProvider: string
      secondsPerPage: number
      modelVariant: PdfOcrModelVariant
    } | null = null
    try {
      await benchmarkPdfOcrStream(
        {
          language: "korean",
          job_id: jobId,
          compare_models: true,
          confirmed: true,
        },
        (event) => {
          if (event.type === "queue") {
            setPdfOcrPhase(event.stage === "queued"
              ? t("OCR 대기 중 · 앞에 {p0}개", { p0: Number(event.waiting_ahead || 0) })
              : t("최적 배치 검사 중"))
            return
          }
          if (event.type === "model_download") {
            setPdfOcrPhase(t("OCR 모델 다운로드·검증 중"))
            return
          }
          if (event.type === "model_benchmark") {
            const stage = String(event.stage || "")
            const modelVariant = normalizePdfOcrModelVariant(event.model_variant)
            const modelIndex = Math.max(1, Number(event.model_index || 1))
            const modelTotal = Math.max(1, Number(event.model_total || 3))
            setPdfOcrBenchmarkProgress((current) => ({
              candidate: current?.candidate || 0,
              candidateTotal: current?.candidateTotal || 1,
              repeat: current?.repeat || 0,
              repeatTotal: current?.repeatTotal || 3,
              modelIndex,
              modelTotal,
              modelVariant,
            }))
            if (stage === "model_start") {
              setPdfOcrPhase(t("{p0} 모델 배치 검사 중", { p0: PDF_OCR_MODEL_LABELS[modelVariant] }))
            } else if (stage === "model_failed") {
              setPdfOcrPhase(t("{p0} 실패 · 다음 모델 검사 중", { p0: PDF_OCR_MODEL_LABELS[modelVariant] }))
            } else if (stage === "selected") {
              measured = {
                batchPages: Number(event.batch_pages || 1),
                detectorBatch: Number(event.detector_batch || 1),
                recognitionBatch: Number(event.recognition_batch || 1),
                gpuProvider: String(event.gpu_provider || "CPU"),
                secondsPerPage: Number(event.seconds_per_page || 0),
                modelVariant,
              }
              setPdfOcrPerformance({
                batchPages: measured.batchPages,
                detectorBatch: measured.detectorBatch,
                recognitionBatch: measured.recognitionBatch,
                renderWorkers: 1,
                gpuProvider: measured.gpuProvider,
                modelVariant,
              })
              setPdfOcrPhase(t("{p0} 권장 모델 선택 완료", { p0: PDF_OCR_MODEL_LABELS[modelVariant] }))
            }
            return
          }
          if (event.type !== "benchmark") return
          const stage = String(event.stage || "")
          const candidateTotal = Math.max(1, Number(event.candidate_total || 1))
          const repeatTotal = Math.max(1, Number(event.repeat_total || 3))
          if (stage === "start") {
            setPdfOcrBenchmarkProgress((current) => ({
              candidate: 0,
              candidateTotal,
              repeat: 0,
              repeatTotal,
              modelIndex: current?.modelIndex || 1,
              modelTotal: current?.modelTotal || 3,
              modelVariant: current?.modelVariant || "tiny",
            }))
          } else if (stage === "testing") {
            setPdfOcrBenchmarkProgress((current) => ({
              candidate: Number(event.candidate || 1),
              candidateTotal,
              repeat: Number(event.repeat || 1),
              repeatTotal,
              modelIndex: current?.modelIndex || 1,
              modelTotal: current?.modelTotal || 3,
              modelVariant: current?.modelVariant || "tiny",
            }))
          }
        },
        controller.signal,
      )
      const completedMeasurement = measured as {
        batchPages: number
        detectorBatch: number
        recognitionBatch: number
        gpuProvider: string
        secondsPerPage: number
        modelVariant: PdfOcrModelVariant
      } | null
      if (!controller.signal.aborted && completedMeasurement) {
        setPdfOcrSavedProfile(null)
        setPdfOcrSavedProfileLoading(true)
        setPdfOcrSavedProfileError("")
        try {
          const savedProfile = await getPdfOcrPerformanceProfile(
            { language: "korean" },
            controller.signal,
          )
          if (!controller.signal.aborted) {
            setPdfOcrSavedProfile(savedProfile)
            setPdfOcrSavedProfileError("")
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            setPdfOcrSavedProfile(null)
            setPdfOcrSavedProfileError(getErrorMessage(error))
          }
        } finally {
          setPdfOcrSavedProfileLoading(false)
        }
        setNotice(
          t("{p0} 권장 모델과 배치를 저장했습니다: 렌더 {p1}p · 검출 {p2}p · 인식 {p3}줄", { p0: PDF_OCR_MODEL_LABELS[completedMeasurement.modelVariant], p1: completedMeasurement.batchPages, p2: completedMeasurement.detectorBatch, p3: completedMeasurement.recognitionBatch }),
        )
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = getErrorMessage(error)
        setPdfOcrBenchmarkError(message)
        setNotice(t("OCR 최적 배치 측정 실패: {p0}", { p0: message }))
      }
    } finally {
      if (pdfOcrBenchmarkAbortRef.current === controller) {
        pdfOcrBenchmarkAbortRef.current = null
        pdfOcrBenchmarkJobIdRef.current = ""
        setPdfOcrBenchmarkProgress(null)
      }
    }
  }

  async function downloadPdfOcrModelAndStart() {
    const path = pdfOcrConfirmPath
    const folderConfirmation = pdfOcrFolderConfirm
    if (
      (!path && !folderConfirmation)
      || pdfOcrModelDownloadProgress
      || pdfOcrSavedProfileLoading
      || !pdfOcrSavedProfile?.model.managed
      || pdfOcrSavedProfile.model.ready
    ) return
    const controller = new AbortController()
    pdfOcrModelDownloadAbortRef.current?.abort()
    pdfOcrModelDownloadAbortRef.current = controller
    setPdfOcrModelDownloadProgress({
      completedBytes: 0,
      totalBytes: pdfOcrSavedProfile.model.file_size,
    })
    setPdfOcrError("")
    setNotice(t("OCR AI 모델을 다운로드하는 중입니다."))
    try {
      await downloadPdfOcrModelStream(
        {
          confirmed: true,
          language,
          model_variant: pdfOcrSavedProfile.model_variant,
          allow_cpu: pdfOcrSavedProfile.state === "unavailable" && pdfOcrSavedProfile.cpu_available,
        },
        (event) => {
          if (event.type !== "model_download") return
          setPdfOcrModelDownloadProgress({
            completedBytes: Number(event.completed_bytes || 0),
            totalBytes: Number(event.total_bytes || pdfOcrSavedProfile.model.file_size),
          })
        },
        controller.signal,
      )
      const refreshed = await getPdfOcrPerformanceProfile({ language })
      setPdfOcrSavedProfile(refreshed)
      if (!refreshed.model.ready) throw new Error(t("다운로드 후 AI 모델 검증에 실패했습니다."))
      setPdfOcrModelDownloadProgress(null)
      if (folderConfirmation) await confirmMaterialFolderPdfOcr(refreshed)
      else await confirmFullPdfOcr(refreshed)
    } catch (error) {
      if (controller.signal.aborted) return
      const message = getErrorMessage(error)
      setPdfOcrError(t("OCR 모델 다운로드 실패: {p0}", { p0: message }))
      setNotice(t("OCR 모델 다운로드 실패: {p0}", { p0: message }))
    } finally {
      if (pdfOcrModelDownloadAbortRef.current === controller) {
        pdfOcrModelDownloadAbortRef.current = null
        setPdfOcrModelDownloadProgress(null)
      }
    }
  }

  function cancelPdfOcrConfirmation() {
    pdfOcrModelDownloadAbortRef.current?.abort()
    pdfOcrModelDownloadAbortRef.current = null
    setPdfOcrModelDownloadProgress(null)
    setPdfOcrConfirmPath("")
    setPdfOcrForceRerun(false)
    setPdfOcrFolderConfirm(null)
  }

  async function startFullPdfOcr(path: string, initialTotal: number, allowCpu = false, force = false, prepareEnvironment = false) {
    if (pdfOcrBenchmarkProgress) return
    const pathKey = normalizedMaterialPath(path).toLocaleLowerCase()
    if (pdfOcrJobIdsByPathRef.current.has(pathKey)) {
      setNotice(t("이 PDF는 이미 OCR 대기열에 있습니다."))
      return
    }
    const problemReviewBaseDir = pdfProblemBaseDir
    const controller = new AbortController()
    const jobId = crypto.randomUUID()
    pdfOcrControllersRef.current.set(jobId, controller)
    pdfOcrJobIdsByPathRef.current.set(pathKey, jobId)
    setPdfOcrJobs((current) => [...current, {
      jobId,
      path,
      title: titleFromPath(path) || "PDF",
      phase: t("OCR 엔진 준비 중"),
      progress: { page: 0, total: initialTotal },
      performance: null,
      cancelPending: false,
    }])
    setPdfOcrError("")
    let skippedForTextLayer = false
    let autoReviewTriggered = false
    let autoReviewStarted = false
    let autoReviewError = ""
    try {
      if (prepareEnvironment) {
        void getPdfOcrPageCount(path, controller.signal).then(({ page_count }) => {
          if (!Number.isInteger(page_count) || page_count < 1) return
          setPdfOcrJobs((current) => current.map((job) => (
            job.jobId === jobId && job.progress.total === 0
              ? { ...job, progress: { ...job.progress, total: page_count } }
              : job
          )))
        }).catch(() => {})
        const profile = await getPdfOcrPerformanceProfile({ language }, controller.signal)
        if (!profile.dependencies.ready) throw new Error(t("OCR 실행 구성요소가 없습니다."))
        allowCpu = profile.state === "unavailable" && profile.cpu_available
        if (!profile.model.ready) {
          if (!profile.model.managed) throw new Error(t("OCR 모델을 사용할 수 없습니다."))
          updatePdfOcrJob(jobId, { phase: t("OCR 모델 다운로드·검증 중") })
          await downloadPdfOcrModelStream({
            confirmed: true,
            language,
            model_variant: profile.model_variant,
            allow_cpu: allowCpu,
          }, (event) => {
            if (event.type !== "model_download") return
            const total = Number(event.total_bytes || 0)
            if (total <= 0) return
            const completed = Number(event.completed_bytes || 0)
            updatePdfOcrJob(jobId, {
              phase: `${t("OCR 모델 다운로드·검증 중")} ${Math.min(100, Math.round(completed * 100 / total))}%`,
            })
          }, controller.signal)
          const refreshed = await getPdfOcrPerformanceProfile({ language }, controller.signal)
          if (!refreshed.model.ready) throw new Error(t("다운로드 후 AI 모델 검증에 실패했습니다."))
        }
      }
      await runFullPdfOcrStream({
        path,
        language,
        allow_cpu: allowCpu,
        force,
        job_id: jobId,
        base_dir: problemReviewBaseDir,
        work_acknowledged: true,
      }, (event) => {
        if (event.type === "auto_review") {
          autoReviewTriggered = true
          const stage = String(event.stage || "")
          if (stage === "analyzing") updatePdfOcrJob(jobId, { phase: t("OCR 완료 · 문제 분석 중") })
          if (stage === "started") {
            autoReviewStarted = true
            updatePdfOcrJob(jobId, { phase: t("문제 분석 완료 · 자동 검수 시작") })
          }
          if (stage === "skipped") updatePdfOcrJob(jobId, { phase: t("문제 분석 완료 · 검수할 문제 없음") })
          return
        }
        if (event.type === "auto_review_model_download") {
          const completed = Number(event.completed_bytes || 0)
          const total = Math.max(1, Number(event.total_bytes || 1))
          updatePdfOcrJob(jobId, { phase: t("OCR 완료 · 로컬 검수 모델 다운로드 {p0}%", { p0: Math.min(100, Math.round(completed * 100 / total)) }) })
          return
        }
        if (event.type === "auto_review_error") {
          autoReviewError = String(event.error || t("자동 검수를 시작하지 못했습니다."))
          return
        }
        if (event.type === "skipped" && event.reason === "text_layer_exists") {
          skippedForTextLayer = true
          updatePdfOcrJob(jobId, { phase: t("텍스트 레이어 확인 · OCR 건너뜀") })
          return
        }
        if (event.type === "queue") {
          updatePdfOcrJob(jobId, {
            phase: event.stage === "queued"
              ? t("OCR 대기 중 · 앞에 {p0}개", { p0: Number(event.waiting_ahead || 0) })
              : t("PDF 원본 준비 중"),
          })
          return
        }
        if (event.type === "model_first_use") {
          updatePdfOcrJob(jobId, { phase: t("OCR 모델 내려받는 중 · 처음 사용이라 시간이 걸립니다") })
          setNotice(String(event.message || ""))
          return
        }
        if (event.type === "model_selection") {
          const selectedModel = normalizePdfOcrModelVariant(event.model_variant)
          updatePdfOcrJob(jobId, { phase: t("{p0} 모델 자동 선택 완료", { p0: PDF_OCR_MODEL_LABELS[selectedModel] }) })
        }
        if (event.type === "calibration") {
          const stage = String(event.stage || "")
          if (stage === "testing") {
            updatePdfOcrJob(jobId, {
              phase: t("안전 배치 시험 {p0}/{p1}", { p0: Number(event.candidate || 1), p1: Number(event.candidate_total || 1) }),
            })
          } else if (stage === "failed") {
            updatePdfOcrJob(jobId, { phase: t("더 안전한 배치로 재시험 중") })
          } else if (stage === "done") {
            updatePdfOcrJob(jobId, { phase: t("안전 배치 확인 완료") })
          }
        }
        if (event.type === "profile") {
          updatePdfOcrJob(jobId, {
            phase: t("PDF 전체 OCR 진행 중"),
            progress: { page: 0, total: Number(event.total || initialTotal) },
            performance: {
              batchPages: Number(event.batch_pages || 1),
              detectorBatch: Number(event.detector_batch || 1),
              recognitionBatch: Number(event.recognition_batch || 1),
              renderWorkers: Number(event.render_workers || 1),
              gpuProvider: String(event.gpu_provider || "CPU"),
              modelVariant: normalizePdfOcrModelVariant(event.model_variant),
            },
          })
        }
        if (event.type === "progress") {
          updatePdfOcrJob(jobId, {
            progress: { page: Number(event.page || 0), total: Number(event.total || initialTotal) },
          })
        }
        if (event.type === "finalizing") {
          const total = Number(event.total || initialTotal)
          if (event.stage === "grammar-refinement") {
            updatePdfOcrJob(jobId, {
              phase: t("인식 완료 · 문법정제 중"),
              progress: { page: Number(event.page || 0), total },
            })
          } else if (event.stage === "writing-pdf") {
            updatePdfOcrJob(jobId, {
              phase: t("인식 완료 · PDF 텍스트 레이어 저장 중"),
              progress: { page: total, total },
            })
          } else if (event.stage === "indexing") {
            updatePdfOcrJob(jobId, {
              phase: t("PDF 저장 완료 · 검색 인덱스 생성 중"),
              progress: { page: total, total },
            })
          }
        }
        if (event.type === "done") updatePdfOcrJob(jobId, { phase: t("PDF OCR 완료") })
        if (event.type === "retry") {
          const progress = { page: 0, total: Number(event.total || initialTotal) }
          if (event.reason === "dml-device-reset") {
            updatePdfOcrJob(jobId, { phase: t("GPU 재설정 감지 · 안전 배치로 재시도 중"), progress })
          } else {
            updatePdfOcrJob(jobId, { progress })
          }
        }
      }, controller.signal)
      if (!controller.signal.aborted) {
        if (skippedForTextLayer) {
          setNotice(t("검색 가능한 텍스트 레이어가 있어 OCR을 실행하지 않았습니다."))
          return
        }
        updatePdfOcrJob(jobId, { phase: t("PDF 뷰어 갱신 중") })
        invalidatePdfOcrTextLayer(path)
        await refreshPdfAfterOcr(path)

        let problemAnalysisFailed = false
        let problemAnalysisCompleted = false
        const problemSourceKey = problemReviewBaseDir
          ? `${normalizedMaterialPath(path).toLocaleLowerCase()}\u0000${normalizedMaterialPath(problemReviewBaseDir).toLocaleLowerCase()}`
          : ""
        if (problemSourceKey) {
          const isCurrentProblemSource = () => activeSourceKeyRef.current === problemSourceKey
          updatePdfOcrJob(jobId, { phase: t("목차 갱신 및 문제 분석 중") })
          if (isCurrentProblemSource()) {
            setPdfProblemsLoading(true)
            setPdfProblemsAnalyzing(true)
            setPdfProblemsError("")
          }
          try {
            const result = autoReviewTriggered
              ? await getPdfProblems(path, problemReviewBaseDir, controller.signal)
              : await scanPdfProblems({
                  pdf_path: path,
                  base_dir: problemReviewBaseDir,
                  force: true,
                }, controller.signal)
            if (!controller.signal.aborted) problemAnalysisCompleted = true
            if (!controller.signal.aborted && isCurrentProblemSource()) {
              const detectedProblems = Array.isArray(result.problems) ? result.problems : []
              setPdfProblems(detectedProblems)
              setPdfProblemsSourceKey(problemSourceKey)
              setPdfProblemAnalysisPendingKey("")
              setPdfProblemAutoReviewError("")
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              problemAnalysisFailed = true
              const message = getErrorMessage(error)
              if (isCurrentProblemSource()) setPdfProblemsError(message)
              setNotice(t("PDF OCR과 목차 갱신은 완료했지만 문제 분석에 실패했습니다: {p0}", { p0: message }))
            }
          } finally {
            if (!controller.signal.aborted && isCurrentProblemSource()) {
              setPdfProblemsLoading(false)
              setPdfProblemsAnalyzing(false)
            }
          }
        }
        if (autoReviewStarted && problemSourceKey && !controller.signal.aborted) {
          try {
            const status = await getPdfProblemAutoReviewStatus(path, problemReviewBaseDir, controller.signal)
            if (activeSourceKeyRef.current === problemSourceKey) setPdfProblemAutoReviewStatus(status)
            if (
              activeSourceKeyRef.current === problemSourceKey
              && PDF_PROBLEM_AUTO_REVIEW_ACTIVE_STATUSES.has(status.status)
            ) {
              pdfProblemAutoReviewPollRef.current?.()
            }
          } catch (error) {
            autoReviewError ||= getErrorMessage(error)
          }
        }
        if (!problemAnalysisFailed) {
          setNotice(
            autoReviewError
              ? t("PDF OCR과 문제 분석은 완료했지만 자동 검수를 시작하지 못했습니다: {p0}", { p0: autoReviewError })
              : autoReviewStarted
                ? t("PDF OCR과 문제 분석을 완료하고 자동 검수를 시작했습니다.")
                : problemAnalysisCompleted
                  ? t("PDF OCR과 문제 분석을 완료했습니다. 문제풀이에서 문제 검수를 실행할 수 있습니다.")
                  : t("PDF OCR과 목차 갱신을 완료했습니다. 연습 폴더를 선택하면 문제를 분석합니다."),
          )
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = getErrorMessage(error)
        setPdfOcrError(message)
        setNotice(t("PDF 전체 OCR 실패: {p0}", { p0: message }))
      }
    } finally {
      pdfOcrControllersRef.current.delete(jobId)
      if (pdfOcrJobIdsByPathRef.current.get(pathKey) === jobId) {
        pdfOcrJobIdsByPathRef.current.delete(pathKey)
      }
      setPdfOcrJobs((current) => current.filter((job) => job.jobId !== jobId))
    }
  }

  async function startMaterialFolderPdfOcr(
    confirmation: NonNullable<typeof pdfOcrFolderConfirm>,
    allowCpu = false,
  ) {
    const controller = new AbortController()
    const jobId = crypto.randomUUID()
    pdfFullOcrAbortRef.current?.abort()
    pdfFullOcrAbortRef.current = controller
    pdfFullOcrJobIdRef.current = jobId
    setPdfOcrError("")
    setPdfOcrPerformance(null)
    setPdfOcrPhase(t("{p0} 전체 OCR 준비 중", { p0: confirmation.name }))
    setPdfFullOcrProgress({ page: 0, total: Math.max(1, confirmation.preflight.ocr_count), unit: "file" })

    let completed = 0
    let skippedText = confirmation.preflight.skipped_text_count
    let failed = confirmation.preflight.unreadable_count
    let autoReviewStarted = 0
    let autoReviewFailed = 0
    try {
      await runMaterialFolderPdfOcrStream({
        folder_path: confirmation.path,
        language,
        allow_cpu: allowCpu,
        job_id: jobId,
        work_acknowledged: true,
      }, (event) => {
        const fileIndex = Number(event.file_index || 0)
        const fileTotal = Math.max(1, Number(event.file_total || confirmation.preflight.ocr_count))
        if (event.type === "folder_preflight") {
          skippedText = Number(event.skipped_text_count || 0)
          failed = Number(event.unreadable_count || 0)
          setPdfFullOcrProgress({ page: 0, total: Math.max(1, Number(event.ocr_count || 0)), unit: "file" })
        } else if (event.type === "model_first_use") {
          setPdfOcrPhase(t("OCR 모델 내려받는 중 · 처음 사용이라 시간이 걸립니다"))
          setNotice(String(event.message || ""))
        } else if (event.type === "file_start") {
          setPdfOcrPhase(t("{p0} OCR 중", { p0: String(event.file_name || "PDF") }))
          setPdfFullOcrProgress({ page: Math.max(0, fileIndex - 1), total: fileTotal, unit: "file" })
        } else if (event.type === "file_done" || event.type === "file_skipped" || event.type === "file_error") {
          setPdfFullOcrProgress({ page: fileIndex, total: fileTotal, unit: "file" })
        } else if (event.type === "profile") {
          setPdfOcrPerformance({
            batchPages: Number(event.batch_pages || 1),
            detectorBatch: Number(event.detector_batch || 1),
            recognitionBatch: Number(event.recognition_batch || 1),
            renderWorkers: Number(event.render_workers || 1),
            gpuProvider: String(event.gpu_provider || "CPU"),
            modelVariant: normalizePdfOcrModelVariant(event.model_variant),
          })
        } else if (event.type === "auto_review") {
          const stage = String(event.stage || "")
          if (stage === "analyzing") setPdfOcrPhase(t("{p0} 문제 분석 중", { p0: String(event.pdf_path || "PDF") }))
          if (stage === "started") autoReviewStarted += 1
        } else if (event.type === "auto_review_model_download") {
          const completedBytes = Number(event.completed_bytes || 0)
          const totalBytes = Math.max(1, Number(event.total_bytes || 1))
          setPdfOcrPhase(t("로컬 검수 모델 다운로드 {p0}%", { p0: Math.min(100, Math.round(completedBytes * 100 / totalBytes)) }))
        } else if (event.type === "auto_review_error") {
          autoReviewFailed += 1
        } else if (event.type === "done") {
          const result = event.result as Record<string, unknown> | undefined
          completed = Number(result?.completed || 0)
          skippedText += Number(result?.skipped_text || 0)
          failed += Number(result?.failed || 0)
        }
      }, controller.signal)
      if (!controller.signal.aborted) {
        await materials.refresh()
        const activePathKey = normalizedMaterialPath(activePath).toLocaleLowerCase()
        const folderPath = normalizedMaterialPath(confirmation.path).toLocaleLowerCase()
        if (activePath && (activePathKey === folderPath || activePathKey.startsWith(`${folderPath}/`))) {
          await refreshPdfAfterOcr(activePath)
        }
        setNotice(t("폴더 전체 OCR 완료: {p0}개 처리 · 텍스트 레이어 {p1}개 제외{p2}{p3}{p4}", { p0: completed, p1: skippedText, p2: failed ? ` · 실패 ${failed}개` : "", p3: autoReviewStarted ? ` · 자동 검수 ${autoReviewStarted}개 시작` : "", p4: autoReviewFailed ? ` · 자동 검수 실패 ${autoReviewFailed}개` : "" }))
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = getErrorMessage(error)
        setPdfOcrError(message)
        setNotice(t("폴더 전체 OCR 실패: {p0}", { p0: message }))
      }
    } finally {
      if (pdfFullOcrAbortRef.current === controller) {
        pdfFullOcrAbortRef.current = null
        pdfFullOcrJobIdRef.current = ""
        setPdfFullOcrProgress(null)
      }
    }
  }

  async function confirmMaterialFolderPdfOcr(profileOverride: PdfOcrPerformanceProfileStatus | null = null) {
    const confirmation = pdfOcrFolderConfirm
    const profile = profileOverride || pdfOcrSavedProfile
    const allowCpu = Boolean(profile?.state === "unavailable" && profile.cpu_available)
    if (
      !confirmation
      || hasAnyPdfOcrWork
      || pdfOcrBenchmarkProgress
      || pdfOcrSavedProfileLoading
      || !profile?.dependencies.ready
      || !profile.model.ready
      || (profile.state === "unavailable" && !allowCpu)
    ) return

    setNotice(t("OCR 직전 텍스트 레이어를 다시 확인하는 중입니다."))
    try {
      const preflight = await getMaterialFolderPdfOcrPreflight(confirmation.path)
      if (preflight.ocr_count <= 0) {
        setPdfOcrFolderConfirm(null)
        setNotice(t("OCR할 PDF가 없습니다. 텍스트 레이어 {p0}개를 제외했습니다.", { p0: preflight.skipped_text_count }))
        return
      }
      const current = { ...confirmation, preflight }
      setPdfOcrFolderConfirm(null)
      await startMaterialFolderPdfOcr(current, allowCpu)
    } catch (error) {
      setPdfOcrError(getErrorMessage(error))
      setNotice(t("폴더 OCR 상태 확인 실패: {p0}", { p0: getErrorMessage(error) }))
    }
  }

  async function prepareMaterialFolderPdfOcr(target: MaterialFolderContextTarget) {
    setPdfOcrError("")
    setPdfOcrForceRerun(false)
    setNotice(t("폴더의 PDF 텍스트 레이어를 확인하는 중입니다."))
    try {
      const preflight = await getMaterialFolderPdfOcrPreflight(target.path)
      setPdfOcrConfirmPath("")
      setPdfOcrFolderConfirm({ path: target.path, name: target.name, preflight })
      setNotice(t("PDF {p0}개를 확인했습니다.", { p0: preflight.pdf_count }))
    } catch (error) {
      setNotice(t("폴더 OCR 확인 실패: {p0}", { p0: getErrorMessage(error) }))
    }
  }

  async function handleManualPdfOcr(targetPath?: string) {
    const path = targetPath || activePath
    if (!path) return
    if (findPdfOcrJobForPath(path)) {
      setNotice(t("이 PDF는 이미 OCR 대기 또는 진행 중입니다."))
      return
    }
    setPdfOcrBenchmarkError("")
    setPdfOcrFolderConfirm(null)
    setPdfOcrForceRerun(true)
    setPdfOcrConfirmPath(path)
    setNotice(t("PDF 텍스트 레이어를 확인하는 중입니다."))
    try {
      const status = await getPdfOcrStatus(path)
      setPdfFullOcrStatus(status)
      if (status.ocr_allowed === false) {
        setPdfOcrConfirmPath("")
        setPdfOcrForceRerun(false)
        setNotice(t("모든 슬라이드에 텍스트 레이어가 있어 OCR을 건너뜁니다."))
        return
      }
      const needsIndexRepair = Boolean(
        status.index_repair_required || (status.ocr_embedded && !status.indexed),
      )
      if (status.has_text && !needsIndexRepair && status.ocr_scope !== "textless_slides") {
        setNotice(t("검색 가능한 텍스트 레이어가 있습니다. OCR 창에서 다시 실행할 수 있습니다."))
      }
    } catch (error) {
      setNotice(t("PDF OCR 상태 확인 실패: {p0}", { p0: getErrorMessage(error) }))
    }
  }

  async function enqueueSelectedPdfOcr(path: string) {
    if (!path) return
    setNotice(t("PDF OCR 요청을 준비하는 중입니다."))
    await startFullPdfOcr(path, 0, false, true, true)
  }

  async function confirmFullPdfOcr(profileOverride: PdfOcrPerformanceProfileStatus | null = null) {
    const path = pdfOcrConfirmPath
    const forceRerun = pdfOcrForceRerun
    const profile = profileOverride || pdfOcrSavedProfile
    const allowCpu = Boolean(profile?.state === "unavailable" && profile.cpu_available)
    if (
      !path
      || Boolean(findPdfOcrJobForPath(path))
      || pdfOcrBenchmarkProgress
      || pdfOcrSavedProfileLoading
      || !profile
      || !profile.dependencies.ready
      || !profile.model.ready
      || (profile.state === "unavailable" && !allowCpu)
    ) return
    setPdfOcrError("")
    setNotice(t("PDF OCR 작업 정보를 확인하는 중입니다."))
    try {
      const status = await getPdfOcrStatus(path)
      setPdfFullOcrStatus(status)
      if (status.ocr_allowed === false) {
        setPdfOcrConfirmPath("")
        setPdfOcrForceRerun(false)
        setNotice(t("모든 슬라이드에 텍스트 레이어가 있어 OCR을 건너뜁니다."))
        return
      }
      const needsIndexRepair = Boolean(
        status.index_repair_required || (status.ocr_embedded && !status.indexed),
      )
      if (status.has_text && !needsIndexRepair && !forceRerun && status.ocr_scope !== "textless_slides") {
        setNotice(t("이 PDF에는 이미 검색 가능한 텍스트가 있습니다."))
        return
      }
      const forceExistingTextLayer = Boolean(forceRerun && status.has_text && !needsIndexRepair)
      const accepted = await confirmWorkPreflight("pdf_ocr", {
        path,
        allow_cpu: allowCpu,
        force: forceExistingTextLayer,
        base_dir: pdfProblemBaseDir,
      })
      if (!accepted) return
      setPdfOcrConfirmPath("")
      setPdfOcrForceRerun(false)
      setNotice(t("PDF OCR 요청을 준비하는 중입니다."))
      await startFullPdfOcr(path, Math.max(1, status.page_count), allowCpu, forceExistingTextLayer)
    } catch (error) {
      const message = getErrorMessage(error)
      setPdfOcrError(t("OCR 상태 확인 실패: {p0}", { p0: message }))
      setNotice(t("PDF OCR 상태 확인 실패: {p0}", { p0: message }))
    }
  }

  useEffect(() => {
    if (!pdfOcrConfirmPath && !pdfOcrFolderConfirm && !pdfOcrSettingsActive) {
      setPdfOcrSavedProfile(null)
      setPdfOcrSavedProfileLoading(false)
      setPdfOcrSavedProfileError("")
      return
    }
    const controller = new AbortController()
    setPdfOcrSavedProfile(null)
    setPdfOcrSavedProfileLoading(true)
    setPdfOcrSavedProfileError("")
    void getPdfOcrPerformanceProfile({ language }, controller.signal).then((status) => {
      if (!controller.signal.aborted) setPdfOcrSavedProfile(status)
    }).catch((error) => {
      if (!controller.signal.aborted) setPdfOcrSavedProfileError(getErrorMessage(error))
    }).finally(() => {
      if (!controller.signal.aborted) setPdfOcrSavedProfileLoading(false)
    })
    return () => controller.abort()
  }, [language, pdfOcrConfirmPath, pdfOcrFolderConfirm, pdfOcrSettingsActive, setPdfOcrSavedProfile, setPdfOcrSavedProfileError, setPdfOcrSavedProfileLoading])

  useEffect(() => {
    setExpandedPdfOutlineSections(new Set())
    setPdfOcrConfirmPath("")
    setPdfOcrForceRerun(false)
    if (!activePath) {
      setPdfFullOcrStatus(null)
      setPdfTextToolsOpen(false)
      return
    }
    setPdfFullOcrStatus(null)
    const controller = new AbortController()
    pdfSettingsLoadAbortRef.current?.abort()
    pdfSettingsLoadAbortRef.current = controller
    void getPdfOcrStatus(activePath, controller.signal).then((status) => {
      if (controller.signal.aborted) return
      setPdfFullOcrStatus(status)
      if (!shouldAutomaticallyPromptPdfOcr(status) || pdfOcrPromptedPathRef.current === activePath) return
      pdfOcrPromptedPathRef.current = activePath
      setPdfOcrConfirmPath(activePath)
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setPdfProblemsLoading(false)
        setPdfProblemsError(getErrorMessage(error))
        console.warn("Failed to inspect PDF OCR status", error)
      }
    })
    return () => {
      controller.abort()
      if (pdfSettingsLoadAbortRef.current === controller) pdfSettingsLoadAbortRef.current = null
    }
  }, [activePath, pdfOcrPromptedPathRef, pdfSettingsLoadAbortRef, setExpandedPdfOutlineSections, setPdfFullOcrStatus, setPdfOcrConfirmPath, setPdfOcrForceRerun, setPdfProblemsError, setPdfProblemsLoading, setPdfTextToolsOpen])

  return {
    activePdfOcrJob,
    cancelPdfOcrConfirmation,
    confirmFullPdfOcr,
    confirmMaterialFolderPdfOcr,
    downloadPdfOcrModelAndStart,
    findPdfOcrJobForPath,
    enqueueSelectedPdfOcr,
    handleBenchmarkPdfOcr,
    handleManualPdfOcr,
    hasAnyPdfOcrWork,
    hasPdfOcrJobs,
    normalizePdfOcrModelVariant,
    prepareMaterialFolderPdfOcr,
    stopBenchmarkPdfOcr,
    stopFullPdfOcr,
    stopPdfOcrJob,
  }
}
