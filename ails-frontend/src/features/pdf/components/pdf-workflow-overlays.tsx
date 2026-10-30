import { PERSONAL_MODE, LOCAL_AI_SETTINGS_ENABLED, SUMMARY_LOCAL_STT_ENABLED } from "../../../edition.ts"
import type { PdfController } from "../hooks/use-pdf-controller.ts"
import type { PdfOcrConfirmationTextState } from "../lib/pdf-ocr-confirmation.ts"
import { t } from "../../../lib/i18n.ts"
import { PdfOcrConfirmDialog } from "./pdf-ocr-confirm-dialog.tsx"
import { PdfOcrFolderConfirmDialog } from "./pdf-ocr-folder-confirm-dialog.tsx"
import { PdfProblemAutoReviewStatus as PdfProblemAutoReviewStatusNotice } from "./pdf-problem-auto-review-status.tsx"
import { PdfTranslationConfirmDialog } from "./pdf-translation-confirm-dialog.tsx"
import { PdfTranslationStatus } from "./pdf-translation-status.tsx"
import { PdfOcrErrorNotice, PdfProblemAutoReviewErrorNotice } from "./pdf-work-error-notices.tsx"

type PdfWorkflowOverlaysProps = {
  actions: {
    ocr: {
      cancelConfirmation: () => void
      confirmFolder: () => unknown
      confirmFull: () => unknown
      downloadModelAndStart: () => unknown
      findJobForPath: (path: string) => unknown
      runManual: () => unknown
    }
    problemReview: {
      cancel: () => unknown
    }
    translation: {
      cancel: () => unknown
      confirm: () => unknown
    }
  }
  activePdfPath: string
  hasAnyPdfOcrWork: boolean
  isProblemAutoReviewActive: boolean
  language: unknown
  managedCloudReady: boolean
  pdf: PdfController
  rerunsExistingText: boolean
  needsIndexRepair: boolean
  textState: PdfOcrConfirmationTextState
}

function pdfOcrLanguageLabel(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (normalized === "english") return "영어"
  if (normalized === "japanese") return "일본어"
  if (normalized === "chinese") return "중국어"
  return "한국어"
}

export function PdfWorkflowOverlays({
  actions,
  activePdfPath,
  hasAnyPdfOcrWork,
  isProblemAutoReviewActive,
  language,
  managedCloudReady,
  needsIndexRepair,
  textState,
  pdf,
  rerunsExistingText,
}: PdfWorkflowOverlaysProps) {
  const ocr = pdf.ocr
  const translation = pdf.translation
  const study = pdf.study

  return (
    <>
      <PdfTranslationConfirmDialog
        onCancel={() => translation.setPdfTranslationConfirmPath("")}
        onConfirm={() => void actions.translation.confirm()}
        path={translation.pdfTranslationConfirmPath}
        providerLabel={
          PERSONAL_MODE ? "ChatGPT 구독" : (managedCloudReady || !LOCAL_AI_SETTINGS_ENABLED)
            ? (LOCAL_AI_SETTINGS_ENABLED ? "DeepSeek API" : t("AILS 관리형 AI"))
            : t("개인 DeepSeek API")
        }
      />

      <PdfOcrFolderConfirmDialog
        confirmation={ocr.pdfOcrFolderConfirm}
        confirmDisabled={Boolean(
          !ocr.pdfOcrFolderConfirm
          || ocr.pdfOcrFolderConfirm.preflight.ocr_count <= 0
          || ocr.pdfFullOcrProgress
          || ocr.pdfOcrBenchmarkProgress
          || ocr.pdfOcrSavedProfileLoading
          || !ocr.pdfOcrSavedProfile
          || ocr.pdfOcrModelDownloadProgress
          || !ocr.pdfOcrSavedProfile?.dependencies.ready
          || (ocr.pdfOcrSavedProfile?.state === "unavailable" && !ocr.pdfOcrSavedProfile.cpu_available)
        )}
        downloadInProgress={Boolean(ocr.pdfOcrModelDownloadProgress)}
        onCancel={actions.ocr.cancelConfirmation}
        onConfirm={() => void (
          ocr.pdfOcrSavedProfile?.model.ready
            ? actions.ocr.confirmFolder()
            : actions.ocr.downloadModelAndStart()
        )}
        profileError={ocr.pdfOcrSavedProfileError}
        profileLoading={ocr.pdfOcrSavedProfileLoading}
      />

      <PdfOcrConfirmDialog
        confirmDisabled={Boolean(
          ocr.pdfOcrBenchmarkProgress
          || actions.ocr.findJobForPath(ocr.pdfOcrConfirmPath)
          || ocr.pdfOcrSavedProfileLoading
          || !ocr.pdfOcrSavedProfile
          || ocr.pdfOcrModelDownloadProgress
          || !ocr.pdfOcrSavedProfile?.dependencies.ready
          || (ocr.pdfOcrSavedProfile?.dependencies.ready
            && ocr.pdfOcrSavedProfile.state === "unavailable"
            && !ocr.pdfOcrSavedProfile.cpu_available)
        )}
        downloadProgress={ocr.pdfOcrModelDownloadProgress}
        languageLabel={pdfOcrLanguageLabel(language)}
        localSttEnabled={SUMMARY_LOCAL_STT_ENABLED}
        needsIndexRepair={needsIndexRepair}
        textState={textState}
        ocrError={ocr.pdfOcrError}
        onCancel={actions.ocr.cancelConfirmation}
        onConfirm={() => void (
          ocr.pdfOcrSavedProfile?.model?.ready
            ? actions.ocr.confirmFull()
            : actions.ocr.downloadModelAndStart()
        )}
        open={Boolean(ocr.pdfOcrConfirmPath)}
        profile={ocr.pdfOcrSavedProfile}
        profileError={ocr.pdfOcrSavedProfileError}
        profileLoading={ocr.pdfOcrSavedProfileLoading}
        rerunsExistingText={rerunsExistingText}
      />

      <PdfTranslationStatus
        canRetry={Boolean(activePdfPath)}
        error={translation.pdfTranslationError}
        onCancel={() => void actions.translation.cancel()}
        onCloseError={() => translation.setPdfTranslationError("")}
        onRetry={() => {
          translation.setPdfTranslationError("")
          translation.setPdfTranslationConfirmPath(activePdfPath)
        }}
        progress={translation.pdfTranslationProgress}
      />

      <PdfProblemAutoReviewStatusNotice
        onCancel={() => void actions.problemReview.cancel()}
        status={study.pdfProblemAutoReviewStatus}
        visible={isProblemAutoReviewActive && !hasAnyPdfOcrWork}
      />
      <PdfProblemAutoReviewErrorNotice
        error={study.pdfProblemAutoReviewError}
        onClose={() => study.setPdfProblemAutoReviewError("")}
        visible={!hasAnyPdfOcrWork}
      />
      <PdfOcrErrorNotice
        canRetry={Boolean(activePdfPath)}
        error={ocr.pdfOcrError}
        onClose={() => ocr.setPdfOcrError("")}
        onRetry={() => void actions.ocr.runManual()}
        visible={!hasAnyPdfOcrWork}
      />
    </>
  )
}
