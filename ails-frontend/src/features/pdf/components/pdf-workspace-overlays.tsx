import type { ReactNode } from "react"

import type { ChatController } from "../../chat/hooks/use-chat-controller.ts"
import type { CodeSandboxWorkspace } from "../../code-sandbox/hooks/use-code-sandbox-workspace.ts"
import type { NotebookController } from "../../notebook/hooks/use-notebook-controller.ts"
import type { PdfController } from "../hooks/use-pdf-controller.ts"
import type { PdfPageOverlays } from "../hooks/use-pdf-page-overlays.tsx"
import type { PdfQuestionHistoryWorkflows } from "../hooks/use-pdf-question-history-workflows.ts"
import type { PdfViewerWorkspace } from "../hooks/use-pdf-viewer-workspace.ts"
import type { PdfWorkspaceWorkflows } from "../hooks/use-pdf-workspace-workflows.ts"
import type { VoiceController } from "../../voice/hooks/use-voice-controller.ts"
import { t } from "../../../lib/i18n.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { MarkdownDocumentSurface } from "../../document/components/markdown-document-surface.tsx"
import { DocumentHeaderActions, type DocumentHeaderActionsProps } from "../../document/components/document-header-actions.tsx"
import type { ViewerMarkdownEditorModel } from "../../document/hooks/use-viewer-editing-workflow.ts"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import { NotebookWorkspace } from "../../notebook/components/lazy-notebook-workspace.tsx"
import { PdfQuickChatBar } from "./pdf-quick-chat-bar.tsx"
import { PdfWorkflowOverlays } from "./pdf-workflow-overlays.tsx"
import { QuestionHistoryDialog } from "./question-history-dialog.tsx"
import { ReflowDocumentViewer } from "../../../shared/components/reflow-document-viewer.tsx"
import type { CodeSandboxWorkspaceOverlay } from "../../code-sandbox/components/code-sandbox-workspace-overlay.tsx"
import type { PracticePdfFileNavigation } from "../../code-sandbox/hooks/use-practice-pdf-files.ts"
import { ViewerFullscreenOverlay } from "./viewer-fullscreen-overlay.tsx"

type PdfWorkspaceOverlaysProps = {
  active: boolean
  homeQuickChat?: boolean
  chat: {
    blocked?: boolean
    canToggleWindow?: () => boolean
    commitDraft: (value: string) => void
    controller: ChatController
    onAsk: (question?: string) => void | Promise<void>
    onStop: () => void
    onDraftChange: (value: string) => void
    panel: ReactNode
    reasoningControl?: ReactNode
    usageIndicator?: ReactNode
    toggleWindow: () => void
  }
  codeSandbox: {
    Overlay: typeof CodeSandboxWorkspaceOverlay
    pdfViewerFloating: boolean
    workspace: CodeSandboxWorkspace
    pdfFileNavigation?: PracticePdfFileNavigation
  }
  document: {
    fullscreenOpen: boolean
    editing: DocumentHeaderActionsProps["editing"] & {editor:ViewerMarkdownEditorModel}
    menu: DocumentHeaderActionsProps["menu"]
    markdown: {
      onAskHighlightedText: (text: string) => void
      onHighlightText: (text: string) => void
      onImageDoubleClick: (src:string, alt:string) => void
      onOpenLocal: (href: string) => void
    }
    notebook: NotebookController
    viewer: ViewerDocument | null
  }
  isBusy: (action: string) => boolean
  /** 자료 문서 다이얼로그는 조립 계층(App)이 렌더링해 주입한다. */
  materialDialogs?: ReactNode
  pdf: {
    controller: PdfController
    pageOverlays: PdfPageOverlays
    viewer: PdfViewerWorkspace
    workflows: PdfWorkspaceWorkflows
  }
  questionHistory: PdfQuestionHistoryWorkflows
  voice: {
    controller: VoiceController
    onStart: () => void | Promise<void>
  }
  workflowContext: {
    language: unknown
    managedCloudReady: boolean
  }
}

export function PdfWorkspaceOverlays({
  active,
  homeQuickChat = false,
  chat,
  codeSandbox,
  document,
  isBusy,
  materialDialogs,
  pdf,
  questionHistory,
  voice,
  workflowContext,
}: PdfWorkspaceOverlaysProps) {
  const CodeSandboxOverlay = codeSandbox.Overlay
  const {
    document: {
      fullscreenPdfViewerContainerRef,
      fullscreenViewerScrollRef,
      isEditingPage,
      pageInputDraft,
      pageInputRef,
      pdfAltCheckpointPage,
      setIsEditingPage,
      setPageInputDraft,
    },
    ocr: {
      codeSandboxOcrInsertRequest,
      pdfFullOcrStatus,
    },
    study: {
      pdfProblemAutoReviewStatus,
      pdfProblemsAnalyzing,
      pdfProblemsLoading,
      pdfProblemsError,
      selectedPdfProblemId,
    },
    view: {
      pdfColorMode,
      pdfThemeBrightness,
      pdfThemeContrast,
      pdfViewZoom,
      setPdfTextToolsOpen,
      pdfTextToolsOpen,
      pdfSearchQuery,
      pdfSearchResults,
      pdfSearchLoading,
      expandedPdfOutlineSections,
      setPdfSearchQuery,
    },
  } = pdf.controller
  const {
    document: viewer,
    navigation,
    ocr: viewerOcr,
    practice,
  } = pdf.viewer
  const {
    autoReview,
    ocr,
    problems,
    translation,
  } = pdf.workflows
  const {
    input: {
      chatInputDraft,
      pdfQuickChatInputRef,
    },
    pdf: {
      pdfQuickChatOpen,
      setPdfQuickChatOpen,
    },
    window: { chatbotWindowOpen },
  } = chat.controller
  const {
    state: {
      voiceAssistantText,
      voiceLatencyText,
      voiceSessionPhase,
      voiceState,
      voiceStatusText,
    },
  } = voice.controller

  const nonPdfContent = document.viewer?.kind === "md" ? (
    <>
      <DocumentHeaderActions document={document.viewer} editing={document.editing} menu={document.menu} />
    <MarkdownDocumentSurface key={document.viewer.id} document={document.viewer}
      active={document.editing.active} markdown={document.markdown} editor={document.editing.editor} scrollRef={fullscreenViewerScrollRef} />
    </>
  ) : document.viewer?.kind === "ipynb" && document.viewer.content ? (
    <NotebookWorkspace
      controller={document.notebook}
      onOpenLocalMarkdown={document.markdown.onOpenLocal}
    />
  ) : document.viewer?.document_model ? (
    <ReflowDocumentViewer document={document.viewer.document_model} />
  ) : document.viewer?.content ? (
    <MarkdownViewer content={document.viewer.content} />
  ) : (
    <div className="rounded-xl bg-[var(--muted)] p-6 text-sm text-[var(--muted-foreground)]">
      {t("표시할 자료가 없습니다.")}
    </div>
  )

  return (
    <>
      {materialDialogs}

      <ViewerFullscreenOverlay
        active={active && document.fullscreenOpen}
        chat={{ open: chatbotWindowOpen, panel: chat.panel }}
        document={document.viewer}
        nonPdfContent={nonPdfContent}
        nonPdfScrollRef={fullscreenViewerScrollRef}
        pageInputRef={pageInputRef}
        page={{
          checkpoint: pdfAltCheckpointPage,
          count: viewer.pageCount,
          current: viewer.currentPage,
          draft: pageInputDraft,
          editing: isEditingPage,
          label: viewer.pageLabel,
          setDraft: setPageInputDraft,
          setEditing: setIsEditingPage,
          spreadActive: viewer.spreadActive,
          submit: navigation.submitPage,
        }}
        pdf={{
          colorMode: pdfColorMode,
          invertTheme: viewer.themeInvertEnabled,
          onMouseEnter: navigation.onViewerMouseEnter,
          onMouseLeave: navigation.onViewerMouseLeave,
          onNavigate: navigation.goByDirection,
          overlay: pdf.pageOverlays.fullscreen,
          themeBrightness: pdfThemeBrightness,
          themeContrast: pdfThemeContrast,
          viewZoom: pdfViewZoom,
          visiblePageNumbers: viewer.visiblePageNumbers,
        }}
        pdfContainerRef={fullscreenPdfViewerContainerRef}
        textTools={{
          available: true,
          statusMessage: !pdfFullOcrStatus ? t("PDF 텍스트 정보를 아직 사용할 수 없습니다. 검색을 시도하거나 문서를 다시 열어 주세요.") : !pdfFullOcrStatus.has_text ? t("검색 가능한 텍스트가 없습니다. OCR 후 검색할 수 있습니다.") : undefined,
          open: pdfTextToolsOpen,
          close: () => setPdfTextToolsOpen(false),
          query: pdfSearchQuery,
          setQuery: setPdfSearchQuery,
          results: pdfSearchResults,
          loading: pdfSearchLoading,
          outline: pdfFullOcrStatus?.outline ?? [],
          expandedSections: expandedPdfOutlineSections,
          onNavigate: navigation.goToPage,
          onSearch: pdf.workflows.search.handlePdfSearch,
          onToggleSection: pdf.workflows.search.togglePdfOutlineSection,
          toggle: () => setPdfTextToolsOpen((current) => !current),
        }}
      />

      <CodeSandboxOverlay
        active={active}
        navigation={{
          onOpenPdfPage: navigation.goToPage,
          onOpenPdfTheoryPage: navigation.goToPage,
          onPdfPageChange: navigation.goByDirection,
          pdfFileNavigation: codeSandbox.pdfFileNavigation,
        }}
        pdfViewerFloating={codeSandbox.pdfViewerFloating}
        practice={{
          active: practice.active,
          activePdfPath: viewer.activePath,
          baseDir: practice.baseDir,
          isAnalyzingProblems: pdfProblemsAnalyzing,
          isLoadingProblems: pdfProblemsLoading,
          ocrInsertRequest: codeSandboxOcrInsertRequest,
          onProblemChange: problems.handlePdfProblemChange,
          onReviewAllProblems: problems.handleReviewAllPdfProblems,
          onReviewAllProblemsLocal: problems.handleReviewAllPdfProblemsLocal,
          onReviewCurrentPage: problems.handleReviewCurrentPdfPage,
          onReviewQueuedProblems: problems.handleReviewQueuedPdfProblems,
          onSelectProblem: problems.handleSelectPdfProblemInWorkspace,
          problemAnalysisError: pdfProblemsError,
          problems: problems.activePdfProblems,
          reviewStatus: pdfProblemAutoReviewStatus,
          selectedProblemId: selectedPdfProblemId,
        }}
        workspace={codeSandbox.workspace}
      />

      <PdfQuickChatBar
        reasoningControl={chat.reasoningControl}
        usageIndicator={chat.usageIndicator}
        chat={{
          blocked: chat.blocked || document.editing.active,
          canToggleWindow: chat.canToggleWindow,
          commitDraft: chat.commitDraft,
          draft: chatInputDraft,
          isBusy: isBusy("chatbot-ask"),
          isChangingModel: isBusy("chatbot-agent-model-save"),
          onAsk: chat.onAsk,
          onStop: chat.onStop,
          onDraftChange: chat.onDraftChange,
          open: pdfQuickChatOpen,
          setOpen: setPdfQuickChatOpen,
          toggleWindow: chat.toggleWindow,
        }}
        inputRef={pdfQuickChatInputRef}
        visible={homeQuickChat || (active && (viewer.studyViewerActive || document.viewer?.kind === "md" || voiceState !== "idle"))}
        voice={{
          assistantText: voiceAssistantText,
          latencyText: voiceLatencyText,
          onStart: voice.onStart,
          phase: voiceSessionPhase,
          state: voiceState,
          statusText: voiceStatusText,
        }}
      />

      <QuestionHistoryDialog
        concepts={questionHistory.concepts}
        deletePendingId={questionHistory.deletePendingId}
        documentTitle={document.viewer?.title}
        error={questionHistory.error}
        loading={questionHistory.loading}
        onCancelDelete={() => questionHistory.setDeletePendingId("")}
        onClose={questionHistory.close}
        onConfirmDelete={(turnId) => void questionHistory.deleteTurn(turnId)}
        onDeleteIntent={questionHistory.setDeletePendingId}
        onRetry={() => void questionHistory.openHistory()}
        open={questionHistory.open}
      />

      <PdfWorkflowOverlays
        actions={{
          ocr: {
            cancelConfirmation: ocr.cancelPdfOcrConfirmation,
            confirmFolder: ocr.confirmMaterialFolderPdfOcr,
            confirmFull: ocr.confirmFullPdfOcr,
            downloadModelAndStart: ocr.downloadPdfOcrModelAndStart,
            findJobForPath: ocr.findPdfOcrJobForPath,
            runManual: ocr.handleManualPdfOcr,
          },
          problemReview: { cancel: autoReview.handleCancelPdfProblemAutoReview },
          translation: {
            cancel: translation.handleCancelPdfTranslation,
            confirm: translation.confirmPdfTranslation,
          },
        }}
        activePdfPath={viewer.activePath}
        hasAnyPdfOcrWork={ocr.hasAnyPdfOcrWork}
        isProblemAutoReviewActive={autoReview.isPdfProblemAutoReviewActive}
        language={workflowContext.language}
        managedCloudReady={workflowContext.managedCloudReady}
        needsIndexRepair={viewerOcr.confirmNeedsIndexRepair}
        textState={viewerOcr.confirmTextState}
        pdf={pdf.controller}
        rerunsExistingText={viewerOcr.confirmRerunsExistingText}
      />
    </>
  )
}
