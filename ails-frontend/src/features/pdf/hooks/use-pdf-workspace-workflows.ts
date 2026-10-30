import { usePdfOcrWorkflows } from "./use-pdf-ocr-workflows.ts"
import { usePdfProblemAutoReviewWorkflow } from "./use-pdf-problem-auto-review-workflow.ts"
import { usePdfProblemWorkflows } from "./use-pdf-problem-workflows.ts"
import { usePdfSearchWorkflows } from "./use-pdf-search-workflows.ts"
import { usePdfStudyDocumentWorkflows } from "./use-pdf-study-document-workflows.ts"
import { usePdfTranslationWorkflows } from "./use-pdf-translation-workflows.ts"
import type { PdfController } from "./use-pdf-controller.ts"

type StudyOptions = Parameters<typeof usePdfStudyDocumentWorkflows>[0]
type AutoReviewOptions = Parameters<typeof usePdfProblemAutoReviewWorkflow>[0]
type OcrOptions = Parameters<typeof usePdfOcrWorkflows>[0]
type TranslationOptions = Parameters<typeof usePdfTranslationWorkflows>[0]
type ProblemOptions = Parameters<typeof usePdfProblemWorkflows>[0]

type UsePdfWorkspaceWorkflowsOptions = {
  configuration: OcrOptions["configuration"]
    & StudyOptions["configuration"]
    & TranslationOptions["configuration"]
    & ProblemOptions["configuration"]
  document: StudyOptions["document"]
    & AutoReviewOptions["document"]
    & OcrOptions["document"]
    & TranslationOptions["document"]
    & ProblemOptions["document"]
  interaction: OcrOptions["interaction"] & ProblemOptions["interaction"]
  materials: OcrOptions["materials"] & TranslationOptions["materials"]
  pdf: PdfController
  study: OcrOptions["study"]
}

export function usePdfWorkspaceWorkflows({
  configuration,
  document,
  interaction,
  materials,
  pdf,
  study: studyContext,
}: UsePdfWorkspaceWorkflowsOptions) {
  const study = usePdfStudyDocumentWorkflows({ pdf, document, configuration })
  const autoReview = usePdfProblemAutoReviewWorkflow({ pdf, document })
  const ocr = usePdfOcrWorkflows({
    configuration,
    document,
    interaction,
    materials,
    pdf,
    study: studyContext,
  })
  const translation = usePdfTranslationWorkflows({
    configuration,
    document,
    interaction: {
      ...interaction,
      hasAnyPdfOcrWork: ocr.hasAnyPdfOcrWork,
    },
    materials,
    pdf,
  })
  const search = usePdfSearchWorkflows({
    activePath: document.activePath,
    pdf,
    setNotice: interaction.setNotice,
  })
  const problems = usePdfProblemWorkflows({
    configuration,
    document,
    interaction,
    pdf,
  })

  return {
    autoReview,
    ocr,
    problems,
    search,
    study,
    translation,
  }
}

export type PdfWorkspaceWorkflows = ReturnType<typeof usePdfWorkspaceWorkflows>
