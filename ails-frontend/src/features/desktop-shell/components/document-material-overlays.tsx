import { lazy, Suspense, type Dispatch, type SetStateAction } from "react"

import type { AILSConfig } from "../../../lib/api"
import type { DocumentMaterialWorkspace } from "../hooks/use-document-material-workspace.ts"
import type { MaterialsController } from "../../materials/hooks/use-materials-controller.ts"
import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import type { useBackendWorkStatus } from "../../background-work/hooks/use-backend-work-status.ts"
import type { useSummaryGenerationWorkflow } from "../../materials/hooks/use-summary-generation-workflow.ts"
import type { useTaskOperations } from "../../background-work/hooks/use-task-operations.ts"
import { MaterialDocumentDialogs } from "../../materials/components/material-document-dialogs.tsx"
import { MaterialPracticeDialog } from "../../materials/components/material-practice-dialog.tsx"
const MaterialPracticeSolver = lazy(() => import("../../materials/components/material-practice-solver.tsx").then(m => ({ default: m.MaterialPracticeSolver })))
import { MaterialsOverlays } from "../../materials/components/materials-overlays.tsx"
import { SummaryGenerationDialog } from "../../materials/components/summary-generation-dialog.tsx"

type DocumentMaterialOverlaysProps = {
  backendStatus: ReturnType<typeof useBackendWorkStatus>
  busy: (key: string) => boolean
  controller: MaterialsController
  documentWorkspace: DocumentMaterialWorkspace
  interaction: {
    generationNotices: string[]
    refresh: () => Promise<unknown>
    runInteraction: Parameters<typeof useSummaryGenerationWorkflow>[0]["interaction"]["runInteraction"]
    setGenerationNotices: Dispatch<SetStateAction<string[]>>
  }
  ocrExcludedPaths: AILSConfig["background_document_ocr_excluded_paths"]
  ocrWorkBusy: boolean
  onDeviceReauthenticate: (title: string) => void
  pdf: PdfController
  summary: ReturnType<typeof useSummaryGenerationWorkflow>
  tasks: ReturnType<typeof useTaskOperations>
}

export function DocumentMaterialOverlays({
  backendStatus,
  busy,
  controller,
  documentWorkspace,
  interaction,
  ocrExcludedPaths,
  ocrWorkBusy,
  onDeviceReauthenticate,
  pdf,
  summary,
  tasks,
}: DocumentMaterialOverlaysProps) {
  const materials = documentWorkspace.materials
  const practice = documentWorkspace.practice

  return (
    <>
      <MaterialsOverlays
        busy={busy}
        controller={controller}
        ocrExcludedPaths={ocrExcludedPaths}
        ocrWorkBusy={ocrWorkBusy}
        onConfirmDeleteBulk={() => void materials.confirmDeleteBulk()}
        onConfirmDeleteFile={() => void materials.confirmDeleteFile()}
        onConfirmDeleteFolder={() => void materials.confirmDeleteFolder()}
        onCreateFolder={(parentPath) => void materials.createFolder(parentPath)}
        onDeleteBulk={(target) => void materials.requestDeleteBulk(target)}
        onDeleteFile={(target) => void materials.requestDeleteFile(target)}
        onDeleteFolder={(target) => void materials.requestDeleteFolder(target)}
        onDeleteTrashItem={(target) => void materials.deleteTrashItem(target)}
        onRequestRestoreTrashItem={materials.requestRestoreTrashItem}
        onConfirmRestoreTrashItem={(folderPath, name) => void materials.confirmRestoreTrashItem(folderPath, name)}
        pendingTrashRestore={materials.pendingTrashRestore}
        onCancelRestoreTrashItem={() => materials.setPendingTrashRestore(null)}
        onGenerateFilePractice={practice.generateForFile}
        onGenerateFolderPractice={practice.generateForFolder}
        onRenameFile={(target) => void materials.renameFileTarget(target)}
        onRunFolderOcr={(target) => void practice.runFolderPdfOcr(target)}
        onToggleOcrExclusion={(path) => void materials.toggleOcrExclusion(path)}
      />
      <MaterialDocumentDialogs
        isBusy={busy}
        mode="blocking"
        pdf={pdf}
        workflow={documentWorkspace.document}
      />
      <SummaryGenerationDialog
        activity={{
          ...backendStatus,
          generationNotices: interaction.generationNotices,
          handleCancelAllTasks: tasks.handleCancelAllTasks,
          handleCancelCurrent: tasks.handleCancelCurrent,
          handleCancelPending: tasks.handleCancelPending,
          handleCancelTask: tasks.handleCancelTask,
          handleDeleteRetryCandidate: tasks.handleDeleteRetryCandidate,
          handlePauseCurrent: tasks.handlePauseCurrent,
          handlePauseTask: tasks.handlePauseTask,
          handleResumeCurrent: tasks.handleResumeCurrent,
          handleResumeTask: tasks.handleResumeTask,
          handleRetryAllFailed: tasks.handleRetryAllFailed,
          handleRetryFailed: tasks.handleRetryFailed,
          refresh: interaction.refresh,
          runInteraction: interaction.runInteraction,
          setGenerationNotices: interaction.setGenerationNotices,
        }}
        isBusy={busy}
        onDeviceReauthenticate={onDeviceReauthenticate}
        workflow={summary}
      />
      <MaterialPracticeDialog
        isBusy={busy}
        onCancel={practice.cancel}
        onSubmit={practice.submit}
        setState={practice.setDialog}
        state={practice.dialog}
      />
      {practice.solverWindows.map(({ documentId, path }) => (
        <Suspense key={documentId} fallback={<p role="status">문제풀이를 준비하고 있습니다.</p>}>
        <MaterialPracticeSolver key={documentId} path={path} active={practice.activeSolverDocumentId === documentId}
          onClose={() => practice.closeSolver(documentId)} />
        </Suspense>
      ))}
    </>
  )
}
