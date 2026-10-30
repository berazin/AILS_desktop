import { IDE_ENABLED } from "../../../edition.ts"
import type { ComponentProps } from "react"

import type { DocumentFeatureHints, UiLanguageCode } from "../lib/document-analysis.ts"
import type { PdfCoreWorkspace } from "../../pdf/hooks/use-pdf-core-workspace.ts"
import type { PdfWorkspaceDomain } from "../../pdf/hooks/use-pdf-workspace-domain.ts"
import { t } from "../../../lib/i18n.ts"
import { DesktopTitleBar } from "./desktop-title-bar.tsx"
import { DocumentLearningTools, type DocumentLearningToolsProps } from "./document-learning-tools.tsx"
import { PdfAnnotationPalette } from "../../pdf/components/pdf-annotation-palette.tsx"
import { PdfViewSettings } from "../../pdf/components/pdf-view-settings.tsx"
import { DocumentMoreMenu } from "./document-more-menu.tsx"
import { ProcessBarWorkButton } from "./process-bar-work-button.tsx"
/* @ails-feature:insight_book:start */
import { InsightBookLauncher } from "../../insight-book/insight-book-launcher.tsx"
/* @ails-feature:insight_book:end */

type TitleBarProps = ComponentProps<typeof DesktopTitleBar>

type DesktopTitleBarWorkspaceProps = {
  actions: TitleBarProps["actions"]
  fullscreen: boolean
  fullscreenOnMaximize?: boolean
  learning?: DocumentLearningToolsProps
  backgroundWork?: { count: number; open: () => void }
  insight?: {
    accountKey: string
    materialRoot: string
    onOpenSource: (path: string, page?: number) => void
  }
  practice?: TitleBarProps["practice"]
  isMaximized: boolean
  localAiSettingsEnabled: boolean
  navigation: TitleBarProps["navigation"]
  onResizeMouseDown: TitleBarProps["onResizeMouseDown"]
  pdf: {
    core: PdfCoreWorkspace
    detection: DocumentFeatureHints
    uiLanguage: UiLanguageCode
    workspace: PdfWorkspaceDomain
  }
  questionHistoryVisible?: boolean
  codeVisible?: boolean
  voiceError: string
}

export function DesktopTitleBarWorkspace({
  actions,
  fullscreen,
  fullscreenOnMaximize,
  learning,
  backgroundWork,
  insight,
  practice,
  isMaximized,
  localAiSettingsEnabled,
  navigation,
  onResizeMouseDown,
  pdf: { core, detection, uiLanguage, workspace },
  questionHistoryVisible,
  codeVisible,
  voiceError,
}: DesktopTitleBarWorkspaceProps) {
  const controller = core.controller
  const { activePdfOcrJob, handleManualPdfOcr, hasAnyPdfOcrWork } = workspace.workflows.ocr
  const { handleManualPdfTranslation } = workspace.workflows.translation
  const {
    document: { activePath, studyViewerActive, presentationViewerActive },
  } = workspace.viewer
  const { pdfOcrBenchmarkProgress } = controller.ocr
  const { pdfBookmarks } = controller.study
  const { pdfTranslationProgress } = controller.translation
  const workCount = (learning?.workCount ?? 0) + (backgroundWork?.count ?? 0)
    + controller.ocr.pdfOcrJobs.length + (controller.ocr.pdfFullOcrProgress && !controller.ocr.pdfOcrJobs.length ? 1 : 0)
    + (pdfOcrBenchmarkProgress ? 1 : 0) + (pdfTranslationProgress ? 1 : 0)

  return (
    <DesktopTitleBar
      actions={actions}
      fullscreen={fullscreen}
      fullscreenOnMaximize={fullscreenOnMaximize}
      learningTools={learning ? <DocumentLearningTools {...learning} workCount={workCount} />
        : backgroundWork ? <ProcessBarWorkButton count={workCount} onOpen={backgroundWork.open} /> : undefined}
      {...{
      /* @ails-feature:insight_book:start */
      insight: insight ? (
        <InsightBookLauncher
          key={insight.accountKey}
          compact
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-normal text-[var(--muted-foreground)] transition-all hover:bg-[var(--brand)] hover:text-white active:scale-95"
          materialRoot={insight.materialRoot}
          onOpenSource={insight.onOpenSource}
        />
      ) : undefined,
      /* @ails-feature:insight_book:end */
      }}
      practice={practice}
      isMaximized={isMaximized}
      navigation={navigation}
      onResizeMouseDown={onResizeMouseDown}
      pdf={{
        active: Boolean(activePath),
        bookmarkCount: pdfBookmarks.length,
        bookmarked: workspace.workflows.study.pdfCurrentPageBookmarked,
      }}
      moreTools={<DocumentMoreMenu
        key={navigation.isHome ? navigation.activeHomeTabId : navigation.activeDocId}
        assist={learning?.assist}
        openQuestionHistory={activePath || questionHistoryVisible ? actions.openQuestionHistory : undefined}
        openCodePractice={IDE_ENABLED && (codeVisible ?? Boolean(activePath)) ? actions.openCodePractice : undefined}
        codeLanguage={detection.codeLanguage}
        openWorkQueue={learning?.openWorkQueue ?? backgroundWork?.open}
        openFeedback={actions.openFeedback}
        settings={studyViewerActive ? <PdfViewSettings view={controller.view} presentation={presentationViewerActive} singlePageOnly={workspace.viewer.document.singlePageOnly} /> : undefined}
        palette={activePath ? {
          open: core.annotation.palette.open,
          setOpen: core.annotation.palette.setOpen,
          content: (
          <PdfAnnotationPalette
            showTrigger={false}
            actions={{
              redo: core.annotation.redo,
              retrySaves: core.annotation.retrySaves,
              setMode: controller.annotation.setPdfAnnotationMode,
              undo: core.annotation.undo,
              updateSettings: core.annotation.updateSettings,
            }}
            containerRef={core.annotation.palette.containerRef}
            model={{
              annotationCount: controller.annotation.pdfAnnotations.length,
              error: controller.annotation.pdfAnnotationError,
              mode: controller.annotation.pdfAnnotationMode,
              pendingCount: controller.annotation.pdfAnnotationPendingCount,
              redoCount: controller.annotation.pdfAnnotationRedo.length,
              settings: controller.annotation.pdfAnnotationSettings,
              undoCount: controller.annotation.pdfAnnotationUndo.length,
            }}
            onOpenChange={core.annotation.palette.setOpen}
            open={core.annotation.palette.open}
          />
          ),
        } : undefined}
        ocr={activePath && detection.needsOcr ? {
          run: handleManualPdfOcr,
          disabled: Boolean(activePdfOcrJob || pdfOcrBenchmarkProgress || pdfTranslationProgress),
          label: activePdfOcrJob
            ? activePdfOcrJob.progress.total <= 0
              ? t("OCR 준비 중")
              : activePdfOcrJob.progress.page >= activePdfOcrJob.progress.total
              ? t("OCR 저장 중")
              : `OCR ${activePdfOcrJob.progress.page}/${activePdfOcrJob.progress.total}`
            : "OCR",
          running: Boolean(activePdfOcrJob),
        } : undefined}
        translation={activePath && detection.language !== "" && detection.language !== uiLanguage ? {
          run: handleManualPdfTranslation,
          disabled: Boolean(pdfTranslationProgress || hasAnyPdfOcrWork || pdfOcrBenchmarkProgress),
          label: pdfTranslationProgress
            ? pdfTranslationProgress.stage === "translating"
              ? t("번역 {p0}/{p1}", {
                  p0: pdfTranslationProgress.completed,
                  p1: pdfTranslationProgress.total,
                })
              : t("번역 처리 중")
            : t("번역"),
          running: Boolean(pdfTranslationProgress),
          title: localAiSettingsEnabled
            ? t("현재 PDF를 DeepSeek로 한국어 번역")
            : t("현재 PDF를 AILS 관리형 AI로 한국어 번역"),
        } : undefined}
      />}
      voiceError={voiceError}
    />
  )
}
