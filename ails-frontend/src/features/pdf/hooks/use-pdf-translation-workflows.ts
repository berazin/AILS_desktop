import { cancelPdfTranslation, runPdfTranslationStream, type PdfOcrLanguage, type WorkPreflightOperation } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import type { PdfController } from "./use-pdf-controller.ts"

type UsePdfTranslationWorkflowsOptions = {
  pdf: PdfController
  document: {
    activePath: string
    pageCount: number
    openMaterialFile: (path: string) => Promise<unknown> | void
  }
  materials: {
    refresh: () => Promise<unknown>
  }
  configuration: {
    language: PdfOcrLanguage
  }
  interaction: {
    confirmWorkPreflight: (
      operation: WorkPreflightOperation,
      payload: Record<string, unknown>,
    ) => Promise<unknown>
    hasAnyPdfOcrWork: boolean
    setNotice: (message: string) => void
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function usePdfTranslationWorkflows({
  pdf,
  document,
  materials,
  configuration,
  interaction,
}: UsePdfTranslationWorkflowsOptions) {
  const {
    translation: {
      pdfTranslationAbortRef,
      pdfTranslationConfirmPath,
      pdfTranslationProgress,
      setPdfTranslationConfirmPath,
      setPdfTranslationError,
      setPdfTranslationProgress,
    },
  } = pdf
  const { activePath, openMaterialFile, pageCount } = document
  const { language } = configuration
  const { confirmWorkPreflight, hasAnyPdfOcrWork, setNotice } = interaction

  function handleManualPdfTranslation(targetPath?: string) {
    const path = targetPath || activePath
    if (!path || pdfTranslationProgress || hasAnyPdfOcrWork) return
    setPdfTranslationError("")
    setPdfTranslationConfirmPath(path)
  }

  async function confirmPdfTranslation() {
    const path = pdfTranslationConfirmPath
    if (!path || pdfTranslationProgress || hasAnyPdfOcrWork) return
    const accepted = await confirmWorkPreflight("pdf_translation", { path })
    if (!accepted) return

    const controller = new AbortController()
    pdfTranslationAbortRef.current?.abort()
    pdfTranslationAbortRef.current = controller
    setPdfTranslationConfirmPath("")
    setPdfTranslationError("")
    setPdfTranslationProgress({
      completed: 0,
      total: Math.max(1, pageCount),
      stage: "preparing",
      label: t("번역 준비 중"),
    })
    setNotice(t("AI PDF 한국어 번역을 시작합니다."))

    let outputPath = ""
    let cancelled = false
    try {
      await runPdfTranslationStream(
        { path, target_language: language, work_acknowledged: true },
        (event) => {
          const eventType = String(event.type || "")
          const total = Math.max(1, Number(event.total || pageCount))
          if (eventType === "cancelled") {
            cancelled = true
            setPdfTranslationProgress(null)
            return
          }
          if (eventType === "stage") {
            setPdfTranslationProgress({
              completed: 0,
              total,
              stage: String(event.stage || "preparing"),
              label: String(event.label || t("PDF 번역 처리 중")),
            })
          } else if (
            eventType === "translation_progress"
            || eventType === "repair_progress"
            || eventType === "render_progress"
            || eventType === "verify_progress"
          ) {
            setPdfTranslationProgress((current) => ({
              completed: Math.max(0, Number(event.completed || 0)),
              total,
              stage: current?.stage || "translating",
              label: current?.label || t("PDF 번역 처리 중"),
            }))
          } else if (eventType === "done") {
            outputPath = String(event.output_path || "")
            setPdfTranslationProgress({
              completed: total,
              total,
              stage: "done",
              label: t("번역 PDF 저장 완료"),
            })
          }
        },
        controller.signal,
      )
      if (!controller.signal.aborted && outputPath && !cancelled) {
        await materials.refresh()
        await openMaterialFile(outputPath)
        setNotice(t("번역 PDF를 저장하고 열었습니다: {p0}", { p0: outputPath }))
      } else if (cancelled) {
        setNotice(t("PDF 번역을 취소했습니다."))
      }
    } catch (error) {
      if (!controller.signal.aborted && !cancelled) {
        const message = getErrorMessage(error)
        setPdfTranslationError(message)
        setNotice(t("PDF 번역 실패: {p0}", { p0: message }))
      }
    } finally {
      if (pdfTranslationAbortRef.current === controller) {
        pdfTranslationAbortRef.current = null
        setPdfTranslationProgress(null)
      }
    }
  }

  async function handleCancelPdfTranslation() {
    if (!pdfTranslationProgress) return
    const controller = pdfTranslationAbortRef.current
    const path = pdfTranslationConfirmPath || activePath
    try {
      if (path) await cancelPdfTranslation(path)
    } catch {
      // 진행 중인 서버 잡이 없더라도 로컬 스트림은 아래에서 중단한다.
    }
    controller?.abort()
  }

  return {
    confirmPdfTranslation,
    handleCancelPdfTranslation,
    handleManualPdfTranslation,
  }
}
