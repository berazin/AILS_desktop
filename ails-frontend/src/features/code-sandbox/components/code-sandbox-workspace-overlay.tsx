import { lazy, Suspense } from "react"

import { AILS_EDITION } from "../../../edition.ts"
import type { PdfProblem, PdfProblemAutoReviewStatus } from "../../../lib/api"
import type { CodeSandboxWorkspace } from "../hooks/use-code-sandbox-workspace.ts"
import { CODING_SPLIT_HANDLE_WIDTH } from "../hooks/use-coding-split-layout.ts"
import { CodeSandboxErrorBoundary } from "./code-sandbox-error-boundary.tsx"
import { CodeSandboxNameDialog } from "./code-sandbox-name-dialog.tsx"
import type { PracticePdfFileNavigation } from "../hooks/use-practice-pdf-files.ts"
import { usePracticeTutor } from "../../practice-tutor/practice-tutor-provider.tsx"

const CodeSandboxWindow = lazy(() =>
  import("./code-sandbox.tsx").then((module) => ({ default: module.CodeSandboxWindow })),
)

const EMPTY_PDF_PROBLEMS: PdfProblem[] = []

type CodeSandboxWorkspaceOverlayProps = {
  active: boolean
  navigation: {
    onOpenPdfPage: (page: number) => void
    onOpenPdfTheoryPage: (page: number, problem?: PdfProblem) => void
    onPdfPageChange: (direction: -1 | 1) => void
    pdfFileNavigation?: PracticePdfFileNavigation
  }
  pdfViewerFloating: boolean
  practice: {
    active: boolean
    activePdfPath: string
    baseDir: string
    isAnalyzingProblems: boolean
    isLoadingProblems?: boolean
    ocrInsertRequest: { id: number; text: string; page: number } | null
    onProblemChange: (problem: PdfProblem) => void
    onReviewAllProblems: () => void | Promise<void>
    onReviewAllProblemsLocal: () => void | Promise<void>
    onReviewCurrentPage: () => void | Promise<void>
    onReviewQueuedProblems: () => void | Promise<void>
    onSelectProblem: (problem: PdfProblem) => void
    problemAnalysisError: string
    problems: PdfProblem[]
    reviewStatus: PdfProblemAutoReviewStatus | null
    selectedProblemId: string
  }
  workspace: CodeSandboxWorkspace
}

export function CodeSandboxWorkspaceOverlay({
  active,
  navigation,
  pdfViewerFloating,
  practice,
  workspace,
}: CodeSandboxWorkspaceOverlayProps) {
  const { actions, dialog, layout, pathInfo, state } = workspace
  const tutor = usePracticeTutor()

  return (
    <>
      <CodeSandboxNameDialog
        draft={dialog.draft}
        onCancel={dialog.cancel}
        onChange={dialog.setDraft}
        onSubmit={dialog.submit}
        open={dialog.open}
      />

      {active && state.mounted && (
        <CodeSandboxErrorBoundary key={state.errorBoundaryKey} onClose={actions.retryAfterError}>
          <Suspense fallback={null}>
            <CodeSandboxWindow
              key={state.windowKey}
              isOpen={state.open}
              onClose={actions.close}
              windowMode={workspace.session.value?.mode}
              baseDir={practice.active ? practice.baseDir : workspace.active.baseDir}
              initialProjectName={practice.active ? pathInfo.projectName : workspace.active.projectName}
              initialFileName={workspace.active.fileName}
              initialActiveFileName={workspace.active.fileName}
              ocrInsertRequest={practice.ocrInsertRequest}
              pdfPath={practice.active ? practice.activePdfPath : ""}
              problemBaseDir={practice.active ? practice.baseDir : undefined}
              problems={practice.active ? practice.problems : EMPTY_PDF_PROBLEMS}
              problemReviewQueueRefreshKey={practice.reviewStatus?.job_id
                ? `${practice.reviewStatus.job_id}:${practice.reviewStatus.status}`
                : ""}
              problemAutoReviewStatus={practice.reviewStatus}
              onReviewAllProblems={practice.active ? practice.onReviewAllProblems : undefined}
              onReviewAllProblemsLocal={practice.active ? practice.onReviewAllProblemsLocal : undefined}
              onReviewCurrentPage={practice.active && AILS_EDITION === "developer"
                ? practice.onReviewCurrentPage
                : undefined}
              onReviewQueuedProblems={practice.active ? practice.onReviewQueuedProblems : undefined}
              selectedProblemId={practice.active ? practice.selectedProblemId : ""}
              isAnalyzingProblems={practice.isAnalyzingProblems}
              isLoadingProblems={practice.isLoadingProblems}
              problemAnalysisError={practice.problemAnalysisError}
              onSelectProblem={practice.onSelectProblem}
              onProblemChange={practice.onProblemChange}
              onSessionChange={actions.handleSessionChange}
              onKeyboardCaptureChange={state.setKeyboardCaptured}
              isSnapped={state.codingModeActive}
              snappedLayout={state.codingModeActive ? layout.snappedCodeLayout : undefined}
              onPdfPageChange={navigation.onPdfPageChange}
              pdfFileNavigation={practice.active ? navigation.pdfFileNavigation : undefined}
              onOpenPdfPage={navigation.onOpenPdfPage}
              onOpenPdfTheoryPage={navigation.onOpenPdfTheoryPage}
              onExitCodingMode={actions.exitCodingMode}
            />
          </Suspense>
        </CodeSandboxErrorBoundary>
      )}

      {active && state.codingModeActive && pdfViewerFloating && !tutor?.open && (
        <div
          aria-hidden="true"
          className="fixed z-[115] -translate-x-1/2 cursor-col-resize select-none bg-transparent"
          style={{
            left: layout.clampedCodingSplitX,
            top: layout.currentPracticeSplitLayout.editor.position.y,
            width: CODING_SPLIT_HANDLE_WIDTH,
            height: layout.currentPracticeSplitLayout.editor.size.height,
          }}
          onMouseDown={layout.handleCodingSplitMouseDown}
        />
      )}
    </>
  )
}
