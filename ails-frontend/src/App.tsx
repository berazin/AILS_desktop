import { useMaterialSiblings } from "./features/materials/hooks/use-material-siblings.ts"
import { useDeferredDocumentOpen } from "./features/document/hooks/use-deferred-document-open.ts"
import { useViewerFeatureActivation } from "./features/desktop-shell/hooks/use-viewer-feature-activation.ts"
import { ChatAnswerEvidence, EvidenceReturnBar } from "./features/chat/components/chat-answer-evidence.tsx"
import { EvidenceNavigationContext } from "./features/chat/lib/evidence-navigation-context.ts"
import { useAnswerEvidenceNavigation } from "./features/chat/hooks/use-answer-evidence-navigation.ts"
import { useEvidenceDocumentNavigation } from "./features/pdf/hooks/use-evidence-document-navigation.ts"
import { captureEvidenceScroll } from "./features/pdf/lib/evidence-scroll.ts"
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react"
import type { ExternalViewerFeature } from "./lib/desktop-api.ts"
import { useViewerWorkspaceHandoff } from "./features/desktop-shell/hooks/use-viewer-workspace-handoff.ts"
import { useMemo, useRef, useState } from "react"
import { getUiLanguage, I18nContext, t } from "./lib/i18n.ts"
import { analyzeDocumentFeatures } from "./features/desktop-shell/lib/document-analysis.ts"
import "./lib/i18n-dicts.ts"
import "katex/dist/katex.min.css"
import { HintOverlay } from "./features/desktop-shell/components/hint-overlay.tsx"
import { DesktopTitleBarWorkspace } from "./features/desktop-shell/components/desktop-title-bar-workspace.tsx"
import { LearningMaterialsPanel } from "./features/materials/components/learning-materials-panel.tsx"
import { useLearningMaterialsPanel } from "./features/desktop-shell/hooks/use-learning-materials-panel.ts"
import { PdfOcrTaskList } from "./features/pdf/components/pdf-ocr-task-list.tsx"
import { prepareDocumentCodeView } from "./features/pdf/lib/document-code-view.ts"
import { ChatAnswerWindow } from "./features/document/components/document-windows.tsx"
import { ChatAnswerMarkdown } from "./features/chat/components/chat-answer-markdown.tsx"
/* @ails-feature:developer_tools:start */
import { DebugTraceWindow } from "./features/desktop-shell/components/debug-trace-window.tsx"
/* @ails-feature:developer_tools:end */
import { SettingsSurface } from "./features/settings/components/lazy-settings-surface.tsx"
import { UpdateNotice } from "./features/settings/components/update-notice.tsx"
import { UpdateBackgroundTask } from "./features/settings/components/update-background-task.tsx"
import { useUpdateStatus } from "./features/settings/hooks/use-update-status.ts"
/* @ails-feature:developer_tools:start */
import { DeveloperToolsOnboarding } from "./features/code-sandbox/components/developer-tools-panel.tsx"
/* @ails-feature:developer_tools:end */
import { FeedbackDialog } from "./features/desktop-shell/components/feedback-dialog.tsx"
import { PdfBookmarkDialog, type PdfBookmarkDialogTab } from "./features/pdf/components/pdf-bookmark-dialog.tsx"
import { HelpDialog } from "./features/desktop-shell/components/help-dialog.tsx"
import { WorkPreflightDialog } from "./features/background-work/components/work-preflight-dialog.tsx"
import { DocumentMaterialOverlays } from "./features/desktop-shell/components/document-material-overlays.tsx"
import { PdfWorkspaceOverlays } from "./features/pdf/components/pdf-workspace-overlays.tsx"
import { ChatComposerControls } from "./features/chat/components/chat-composer-controls.tsx"
import { ChatGPTPlanIndicatorForConfig } from "./features/chat/components/chatgpt-plan-indicator.tsx"
import { CodeSandboxWorkspaceOverlay } from "./features/code-sandbox/components/code-sandbox-workspace-overlay.tsx"
import { PdfWorkspaceViewer } from "./features/pdf/components/pdf-workspace-viewer.tsx"
import { homeWorkspaceHasSelection } from "./features/desktop-shell/lib/home-quick-chat-shortcuts.ts"
import { MaterialDocumentDialogs } from "./features/materials/components/material-document-dialogs.tsx"
import { MaterialSearchModal } from "./features/materials/components/material-search-modal.tsx"
import { focusInlineMaterialSearch } from "./features/materials/focus-inline-search.ts"
import { useMaterialSearchModal, type OpenMaterialSearchResult } from "./features/materials/hooks/use-material-search-modal.ts"
import {
  ExpertFallbackDialog,
} from "./features/chat/components/expert-fallback-dialog.tsx"
import { BackgroundWorkQueueDialog } from "./features/background-work/components/background-work-queue-dialog.tsx"
import { AIConsentGate } from "./features/settings/components/ai-compliance.tsx"
import { ManagedAccountDialogs } from "./features/settings/components/managed-account-dialogs.tsx"
import { ChatWorkspaceView } from "./features/chat/components/chat-workspace-view.tsx"
import { PracticeTutorChatWorkspaceView } from "./features/practice-tutor/components/practice-tutor-chat-workspace-view.tsx"
import { WorkspaceSurfaceContent } from "./features/desktop-shell/components/workspace-surface-content.tsx"
import {
  readWorkspaceSessionState,
  type WorkspaceSessionState,
} from "./lib/workspace-session-state.ts"
import {
  chatbotModelName,
} from "./lib/chatbot-display.ts"
import { normalizeSttConfigForEdition } from "./lib/stt-config.ts"
import { useManagedAccount } from "./features/settings/hooks/use-managed-account.ts"
import { useChatController } from "./features/chat/hooks/use-chat-controller.ts"
import { useHintMode } from "./features/desktop-shell/hooks/use-hint-mode.ts"
import { useAppKeyboardShortcuts } from "./features/desktop-shell/hooks/use-app-keyboard-shortcuts.ts"
import { useDesktopShellLayout } from "./features/desktop-shell/hooks/use-desktop-shell-layout.ts"
import { useFullscreenEscape } from "./features/desktop-shell/hooks/use-fullscreen-escape.ts"
import { useDebugTraceWorkflow } from "./features/desktop-shell/hooks/use-debug-trace-workflow.ts"
import { useMaterialsController } from "./features/materials/hooks/use-materials-controller.ts"
import { useSettingsController } from "./features/settings/hooks/use-settings-controller.ts"
import { useSettingsWorkflows } from "./features/settings/hooks/use-settings-workflows.ts"
import { useVoiceController } from "./features/voice/hooks/use-voice-controller.ts"
import { useSummaryGenerationWorkflow } from "./features/materials/hooks/use-summary-generation-workflow.ts"
import { useChatVoiceWorkspace } from "./app/workspaces/use-chat-voice-workspace.ts"
import { usePdfQuestionHistoryWorkflows } from "./features/pdf/hooks/use-pdf-question-history-workflows.ts"
import { usePdfCoreWorkspace } from "./features/pdf/hooks/use-pdf-core-workspace.ts"
import { usePdfWorkspaceDomain } from "./features/pdf/hooks/use-pdf-workspace-domain.ts"
import { useNotebookWorkspace } from "./features/notebook/hooks/use-notebook-workspace.ts"
import { useAppearanceController } from "./features/settings/hooks/use-appearance-controller.ts"
import { useModelSettingsController } from "./features/settings/hooks/use-model-settings-controller.ts"
import { useEventCallback } from "./shared/hooks/use-event-callback.ts"
import { useWorkspaceFolderNavigation } from "./features/desktop-shell/hooks/use-workspace-folder-navigation.ts"
import { useHomeTabFolderNavigation } from "./features/desktop-shell/hooks/use-home-tab-folder-navigation.ts"
import { useWorkspacePageTabs } from "./features/desktop-shell/hooks/use-workspace-page-tabs.ts"
import { useInteractionRunner } from "./features/code-sandbox/hooks/use-interaction-runner.ts"
import { useTaskOperations } from "./features/background-work/hooks/use-task-operations.ts"
import { useAppStatus } from "./features/desktop-shell/hooks/use-app-status.ts"
import { normalizePdfViewZoom, PDF_VIEW_ZOOM_STEP } from "./lib/pdf-view-layout.ts"
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationEntry,
} from "./features/desktop-shell/hooks/use-workspace-navigation-history.ts"
import { useBackendWorkStatus } from "./features/background-work/hooks/use-backend-work-status.ts"
import { useSettingsMetadata } from "./features/settings/hooks/use-settings-metadata.ts"
import { useDocumentMaterialWorkspace } from "./features/desktop-shell/hooks/use-document-material-workspace.ts"
import { useWorkspaceSessionPersistence } from "./features/desktop-shell/hooks/use-workspace-session-persistence.ts"
import { useWorkPreflightWorkflow } from "./features/background-work/hooks/use-work-preflight-workflow.ts"
import { useExpertFallbackWorkflow } from "./features/chat/hooks/use-expert-fallback-workflow.ts"
import { useTextEntryActivity } from "./features/desktop-shell/hooks/use-text-entry-activity.ts"
import { useAppBootstrap } from "./app/startup/use-app-bootstrap.ts"
import { useDocumentWorkspace } from "./features/document/hooks/use-document-workspace.ts"
import { useDocumentFind } from "./features/document/hooks/use-document-find.ts"
import { DocumentFindBar } from "./features/document/components/document-find-bar.tsx"
import { useCodeSandboxWorkspace } from "./features/code-sandbox/hooks/use-code-sandbox-workspace.ts"
import { usePracticeTutorWorkspace } from "./features/practice-tutor/hooks/use-practice-tutor-workspace.ts"
import { PracticeTutorProvider } from "./features/practice-tutor/practice-tutor-provider.tsx"
import { PracticeTutorDock } from "./features/practice-tutor/components/practice-tutor-dock.tsx"
import { useFolderWorkbench } from "./features/code-sandbox/workspaces/use-folder-workbench.ts"
import { practiceIdeLayout } from "./features/code-sandbox/lib/practice-ide-layout.ts"
import { useWorkspaceFileOpen } from "./features/code-sandbox/workspaces/use-workspace-file-open.ts"
import { SPLIT_PICKER_ID } from "./features/code-sandbox/workspaces/session.ts"
import { workspaceWindowStorage } from "./lib/workspace-window-storage.ts"
import { useExternalDocuments } from "./features/desktop-shell/hooks/use-external-documents.ts"
import { useWorkspaceTabTransfer } from "./features/desktop-shell/hooks/use-workspace-tab-transfer.ts"
import {
  DEVELOPER_TOOLS_ENABLED,
  LOCAL_AI_SETTINGS_ENABLED,
  SUMMARY_STT_ENABLED,
} from "./edition.ts"

import {
  type PdfOcrLanguage,
  type ManagedAuthStatus,
  retryFailedTask,
  openFileDialog,
} from "./lib/api"

// Mirrors backend normalize_app_language so OCR/translation requests always
// send one of the supported language codes.
function appLanguage(value: unknown): PdfOcrLanguage {
  const raw = String(value ?? "").trim().toLowerCase()
  if (raw === "english" || raw === "en") return "english"
  if (raw === "japanese" || raw === "ja" || raw === "jp") return "japanese"
  if (raw === "chinese" || raw === "zh") return "chinese"
  return "korean"
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function App() {
  const [notice, setNotice] = useState("")
  const {
    busyActions,
    generationNotices,
    isBusy,
    runInteraction,
    setGenerationNotices,
  } = useInteractionRunner({ setNotice })
  const appearance = useAppearanceController({ setNotice })
  const {
    accent,
    appThemeRootRef,
    resolvedTheme,
  } = appearance
  const [initialWorkspaceSession] = useState<WorkspaceSessionState | null>(() =>
    typeof window === "undefined" ? null : readWorkspaceSessionState(workspaceWindowStorage()),
  )
  const latestWorkspaceSessionRef = useRef<WorkspaceSessionState | null>(initialWorkspaceSession)
  const { editionIntegrityError, options } = useAppBootstrap({
    loadModelOptions: () => modelSettings.loadOptions(),
    refreshApp: () => refresh(),
    refreshMaterials: () => refreshLectureMaterials(),
  })
  const {
    prompt: expertFallbackPrompt,
    request: requestExpertFallbackChoice,
    resolve: resolveExpertFallbackChoice,
  } = useExpertFallbackWorkflow()
  const settings = useSettingsController()
  const chat = useChatController({
    initialDraft: initialWorkspaceSession?.chatbot?.draft ?? "",
    initialOpen: initialWorkspaceSession?.chatbot?.open === true,
  })
  const {
    config: draftConfig,
    i18nVersion,
    lmsPasswordDraft,
    open: settingsOpen,
    setConfig: setDraftConfig,
    setLmsPasswordDraft,
  } = settings
  const documentWorkspace = useDocumentWorkspace({
    closeSettings: () => settingsWorkflows.close(),
    setNotice,
    settingsOpen,
  })
  const { selectedReport, selectedReportId, setSelectedReport, setSelectedReportId } = documentWorkspace.reports
  const {
    actions: {
      closeDocumentTab: handleCloseLectureDocTab,
      openNewTab: handleNewTab,
      selectDocumentTab: handleSelectLectureDocTab,
    },
    documents: {
      items: lectureReportDocs,
      selected: selectedLectureDoc,
      selectedId: selectedLectureDocId,
      session: sessionViewerDocument,
      setItems: setLectureReportDocs,
      setSelectedId: setSelectedLectureDocId,
      viewer: viewerDocument,
      viewerRef: viewerDocumentRef,
    },
    recent: {
      files: recentFiles,
      setFiles: setRecentFiles,
    },
    surface: {
      set: setWorkspaceSurface,
      value: workspaceSurface,
    },
    ui: {
      mdMoreMenuOpen,
      setMdMoreMenuOpen,
    },
  } = documentWorkspace
  const modelSettings = useModelSettingsController()
  const { modelOptions, setModelOptions } = modelSettings
  const { managedAiPolicy, managedAiPolicyError, phoenixStatus } = useSettingsMetadata({
    developerToolsEnabled: DEVELOPER_TOOLS_ENABLED,
    open: settingsOpen,
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const questionHistory = usePdfQuestionHistoryWorkflows({
    getPdfPath: () => activePdfPath || viewerDocument?.file_path || viewerDocument?.id || "",
    onOpen: () => setHelpOpen(false),
    onNotice: setNotice,
    runInteraction,
  })
  const {
    open: questionHistoryOpen,
    reset: resetQuestionHistory,
  } = questionHistory
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [pdfBookmarkDialog, setPdfBookmarkDialog] = useState<{ open: boolean; tab: PdfBookmarkDialogTab }>({
    open: false,
    tab: "add",
  })
  const [backgroundWorkQueueOpen, setBackgroundWorkQueueOpen] = useState(false)
  const closeBackgroundWorkQueue = useEventCallback(() => setBackgroundWorkQueueOpen(false))
  const updateWork = useUpdateStatus()
  const materials = useMaterialsController({ setNotice })
  const {
    actions: {
      loadFile: loadMaterialFile,
      refreshLectureMaterials,
    },
    data: {
      lectureMaterials,
    },
    pendingDelete: {
      pendingBulkDelete,
      pendingFileDelete,
      pendingFolderDelete,
    },
  } = materials
  const voice = useVoiceController()
  const hintMode = useHintMode({ setNotice })
  const pdfCore = usePdfCoreWorkspace({
    initialWorkspaceSession,
    mdSavePath: String(draftConfig.md_save_path ?? ""),
  })
  const pdf = pdfCore.controller
  const viewerFullscreenOpen = pdfCore.fullscreen.open
  const setViewerFullscreenOpen = pdfCore.fullscreen.setOpen
  useFullscreenEscape(viewerFullscreenOpen, setViewerFullscreenOpen)
  const pdfAnnotationPaletteOpen = pdfCore.annotation.palette.open
  const setPdfAnnotationPaletteOpen = pdfCore.annotation.palette.setOpen
  const pdfAnnotationPaletteRef = pdfCore.annotation.palette.containerRef
  const {
    document: {
      fullscreenViewerScrollRef,
      latestPdfPageRef,
      pdfPageByDocument,
      pendingLibreOfficeFilePath,
      pendingPdfPasswordPath,
      viewerScrollRef,
    },
    ocr: {
      pdfFullOcrStatus, pdfOcrBenchmarkProgress,
      pdfOcrConfirmPath, pdfOcrFolderConfirm,
    },
    study: { selectedPdfProblemId },
    translation: {
      pdfTranslationConfirmPath,
    },
  } = pdf
  const applyPdfAnnotation = pdfCore.annotation.applyAnnotation
  const redoPdfAnnotation = pdfCore.annotation.redo
  const removePdfAnnotation = pdfCore.annotation.removeAnnotation
  const undoPdfAnnotation = pdfCore.annotation.undo
  const { handleAppWindowResizeMouseDown, isMaximized, setIsMaximized, viewportSize } = useDesktopShellLayout()
  const learningMaterialsPanel = useLearningMaterialsPanel(workspaceSurface)
  const textEntryActiveRef = useTextEntryActivity()

  const {
    confirm: confirmWorkPreflight,
    preflight: workPreflight,
    resolve: resolveWorkPreflight,
  } = useWorkPreflightWorkflow({ setNotice })
  const pdfFloatingWindow = pdfCore.floatingWindow
  const {
    pdfViewerFloating,
    pdfViewerPosition,
    pdfViewerSize,
    setPdfViewerFloating,
    setPdfViewerPosition,
    setPdfViewerSize,
  } = pdfFloatingWindow

  const lectureMaterialsScrollRef = useRef<HTMLDivElement | null>(null)
  const mainScrollRef = useRef<HTMLElement | null>(null)
  const viewerPaneRef = useRef<HTMLElement | null>(null)
  const workspaceTopRef = useRef<HTMLDivElement | null>(null)
  const pendingDeviceRetryRef = useRef<{ title: string; email: string } | null>(null)

  const managedAccount = useManagedAccount({
    config: draftConfig,
    onLoginCancelled: () => { pendingDeviceRetryRef.current = null },
    onLoginSuccess: async (status: ManagedAuthStatus) => {
      const pending = pendingDeviceRetryRef.current
      pendingDeviceRetryRef.current = null
      if (!pending) return
      if (!pending.email || pending.email !== String(status.email || "").trim().toLocaleLowerCase()) {
        return t("로그인 계정이 이전 작업의 계정과 달라 자동 재시도하지 않았습니다.")
      }
      try {
        await retryFailedTask(pending.title)
        await refresh()
        return t("다시 로그인했습니다. 실패한 영상 작업을 재시도합니다: {p0}", { p0: pending.title })
      } catch (error) {
        return t("로그인은 완료됐지만 영상 작업 재시도에 실패했습니다: {p0}", { p0: error instanceof Error ? error.message : String(error) })
      }
    },
    runInteraction,
    setConfig: setDraftConfig,
    setNotice,
  })
  const {
    managedAuthOpen,
    managedAuthStatus,
    managedCreditOpen,
    prepareForSettings: prepareManagedAccountForSettings,
  } = managedAccount
  const aiAssistModelLabel = useMemo(() => {
    const modelId = String(draftConfig.local_voice_agent_model || "auto").trim()
    if (modelId === "auto") return t("하드웨어 자동")
    const agentModel = modelOptions?.chatbot_agent_models?.find((m) => m.id === modelId)
    return agentModel?.name ?? modelId
  }, [draftConfig.local_voice_agent_model, modelOptions])

  const layoutScale = useMemo(() => {
    const compactWindowScale = Math.min(
      clamp(viewportSize.width / 1680, 0.68, 1),
      clamp(viewportSize.height / 1050, 0.74, 1),
    )
    const highResolutionScale = Math.min(
      clamp(1920 / viewportSize.width, 0.72, 1),
      clamp(1080 / viewportSize.height, 0.78, 1),
    )
    return Math.min(compactWindowScale, highResolutionScale)
  }, [viewportSize.height, viewportSize.width])

  const themeVars = useMemo(
    () =>
      ({
        "--brand": accent,
        "--brand-soft": `${accent}1f`,
        "--app-font-size": `${16 * layoutScale}px`,
        "--viewer-height": `max(300px, calc(100vh - ${Math.round(245 * layoutScale)}px))`,
        "--viewer-min-height": `${Math.round(560 * layoutScale)}px`,
      }) as CSSProperties,
    [accent, layoutScale],
  )

  const { apiError, payload, refresh, setApiError } = useAppStatus({
    getConfigSyncToken: () => settings.configSavePendingRef.current ? null : settings.config,
    hasInitialMaterial: Boolean(initialWorkspaceSession?.material?.filePath),
    normalizeConfig: normalizeSttConfigForEdition,
    refreshMaterials: refreshLectureMaterials,
    selectedReportId,
    setConfig: setDraftConfig,
    setSelectedReportId,
    settingsOpen,
    workspaceSurface,
  })

  const debugEvents = payload?.status.debug_events ?? []
  const debugTrace = useDebugTraceWorkflow({ events: debugEvents, runInteraction })
  const settingsWorkflows = useSettingsWorkflows({
    appearance,
    developerToolsEnabled: DEVELOPER_TOOLS_ENABLED,
    modelSettings,
    normalizeConfig: normalizeSttConfigForEdition,
    onPrepareAccount: prepareManagedAccountForSettings,
    onRefreshApp: refresh,
    onRefreshMaterials: refreshLectureMaterials,
    options,
    pdfView: pdf.view,
    runInteraction,
    setDebugTraceWindowOpen: debugTrace.setOpen,
    setNotice,
    setWorkspaceSurface,
    settings,
    workspaceSurface,
  })

  const summaryGeneration = useSummaryGenerationWorkflow({
    config: {
      draft: draftConfig,
      lmsPasswordDraft,
      setDraft: setDraftConfig,
      setLmsPasswordDraft,
    },
    documents: {
      openImportedReport: (reportId) => {
        setSelectedReportId(reportId)
        setWorkspaceSurface("document")
      },
    },
    interaction: {
      confirmWorkPreflight,
      refreshMaterials: refreshLectureMaterials,
      refreshStatus: () => refresh(),
      runInteraction,
      setNotice,
    },
  })
  const {
    actions: {
      /* @ails-feature:summary.web_inputs:start */
      saveLmsAccount: handleSaveLmsCredentials,
      /* @ails-feature:summary.web_inputs:end */
      setOpen: setLectureAddExpanded,
    },
    state: {
      open: lectureAddExpanded,
    },
  } = summaryGeneration

  /* @ails-summary-generation:start */
  const taskOperations = useTaskOperations({
    refreshMaterials: refreshLectureMaterials,
    refreshStatus: () => refresh(),
    runInteraction,
    runtime: settings.runtime,
  })
  const {
    handleLatexPostprocess,
    handleOpenDistributionLicenses,
    handlePickPythonExecutable,
    handlePickSaveDirectory,
    refreshPythonRuntime,
  } = taskOperations

  // goToSiblingMaterial, handleAskPdfSlideExplanation은 PDF 뷰어 미니멀화 및 추가 설명 버튼 제거에 따라 미사용 제거됨

  const backendWorkStatus = useBackendWorkStatus({
    debugTraceOpen: debugTrace.open,
    queueOpen: backgroundWorkQueueOpen,
    lmsScanBusy: isBusy("lms-scan-submit"),
    payload,
    refresh,
    setGenerationNotices,
  })

  const documentMaterialWorkspace = useDocumentMaterialWorkspace({
    getHomeChatSnapshot: () => {
      const messages = chat.messages.chatMessagesByDocument.global ?? []
      const pairs: Array<Array<{ id: string; role: "user" | "assistant"; content: string }>> = []
      for (let index = 0; index + 1 < messages.length; index += 1) {
        const user = messages[index]
        const assistant = messages[index + 1]
        if (user.role !== "user" || assistant.role !== "assistant" || !assistant.answerSource || assistant.activity) continue
        if (!user.content.trim() || !assistant.content.trim()) continue
        pairs.push([
          { id: user.id, role: "user", content: user.content.trim() },
          { id: assistant.id, role: "assistant", content: assistant.content.trim() },
        ])
        index += 1
      }
      let remaining = 4800
      const selected = [] as typeof pairs
      for (const pair of pairs.slice(-6).reverse()) {
        const length = pair[0].content.length + pair[1].content.length
        if (length > remaining) continue
        selected.unshift(pair)
        remaining -= length
      }
      return selected.flat()
    },
    documents: {
      selectedId: selectedLectureDocId,
      items: lectureReportDocs,
      homeTabId: workspaceSurface === "dashboard" ? documentWorkspace.documents.activeHomeTabId : undefined,
      replaceHomeTab: documentWorkspace.actions.replaceHomeTab,
      restoreHomeTab: documentWorkspace.actions.restoreHomeTab,
      replaceTabId: documentWorkspace.actions.replaceTabId,
      onDocumentReplaced: (previousId, document) => {
        folderWorkbench.replaceDocument(previousId, document)
        codeSandboxWorkspace.actions.replaceDocument(previousId, document.id, {
          retainPrevious: lectureReportDocs.some(item => item.id === document.id),
        })
      },
      setDocuments: setLectureReportDocs,
      setSelectedDocumentId: setSelectedLectureDocId,
      setSelectedReport,
      setSelectedReportId,
      setWorkspaceSurface,
      viewerDocument,
    },
    interaction: {
      refreshStatus: refresh,
      runInteraction,
      setNotice,
    },
    materials,
    ocrExclusion: {
      paths: draftConfig.background_document_ocr_excluded_paths,
      setNotice,
      setPaths: (paths) => setDraftConfig((current) => ({
        ...current,
        background_document_ocr_excluded_paths: paths,
      })),
    },
    pdf,
    prepareFolderPdfOcr: (target) => prepareMaterialFolderPdfOcr(target),
    recent: {
      files: recentFiles,
      setFiles: setRecentFiles,
    },
    scroll: {
      fullscreen: viewerFullscreenOpen,
      fullscreenViewerRef: fullscreenViewerScrollRef,
      primaryViewerRef: viewerScrollRef,
      treeRef: lectureMaterialsScrollRef,
    },
    workspaceSurface,
  })
  const materialDocumentWorkflows = documentMaterialWorkspace.document
  const {
    linkedMarkdownWindow,
    openLinkedMarkdown: handleOpenLinkedMarkdown,
    openMaterialFile: openMaterialDocument,
    openMaterialFileInBackground: handleOpenMaterialFileInBackground,
  } = materialDocumentWorkflows
  const documentDetection = useMemo(() => analyzeDocumentFeatures(viewerDocument), [viewerDocument])
  const {
    dialog: practiceDialog,
  } = documentMaterialWorkspace.practice
  const viewerEditing = documentMaterialWorkspace.editing
  const {
    actions: {
      applyMarkdownContent: applyViewerMarkdownContent,
      applySavedFile: applySavedViewerDocument,
      enterEditMode: enterViewerEditMode,
      handleViewerEditKeyDown,
      leaveEditMode: leaveViewerEditMode,
      redoDirectly: redoViewerDirectly,
      redoDraft: redoViewerDraft,
      removeTopVisibleImage,
      undoDirectly: undoViewerDirectly,
      undoDraft: undoViewerDraft,
    },
    editor: viewerMarkdownEditor,
    refs: { editingTextareaRef },
    state: {
      draftContent: viewerDraftContent,
      editMode: viewerEditMode,
      previewPending: viewerPreviewPending,
    },
  } = viewerEditing
  const materialWorkflows = documentMaterialWorkspace.materials
  const {
    toggleOcrExclusion: handleToggleOcrExclusion,
  } = materialWorkflows
  const markdownHighlightTextHandler = documentMaterialWorkspace.markdown.onHighlightText
  const markdownImageDoubleClickHandler = documentMaterialWorkspace.markdown.onImageDoubleClick

  const homeFolderNavigation = useHomeTabFolderNavigation(documentWorkspace.documents.activeHomeTabId, lectureMaterials?.folders)
  const diskSiblings = useMaterialSiblings(viewerDocument?.file_path)

  const folderWorkbench = useFolderWorkbench({
    documents: lectureReportDocs,
    setDocuments: setLectureReportDocs,
    selectedId: selectedLectureDocId,
    selectDocument: handleSelectLectureDocTab,
    closeDocument: handleCloseLectureDocTab,
    surface: workspaceSurface,
    setSurface: setWorkspaceSurface,
    onOpenPdf: openMaterialDocument,
    codePageId: documentWorkspace.documents.homeTabs.find((tab) => tab.id === documentWorkspace.documents.activeHomeTabId && tab.kind === "code")?.id,
    replacePageTab: documentWorkspace.actions.replaceHomeTab,
    revealTabs: documentWorkspace.actions.revealTabs,
    onEmptyWorkspace: documentWorkspace.actions.selectRemainingPageTab,
    onStartWithDocument: (document) => prepareDocumentCodeView(document, { pdf, setFloating: setPdfViewerFloating }),
  })
  const setExternalViewerFeature = useViewerFeatureActivation({
    path: viewerDocument?.file_path, loading: viewerDocument?.loading,
    blocked: Boolean(pendingPdfPasswordPath || pendingLibreOfficeFilePath),
    activate: request => applyExternalViewerFeature(request),
  })
  const prepareViewerHandoff = useViewerWorkspaceHandoff(viewerDocument, Boolean(pendingPdfPasswordPath || pendingLibreOfficeFilePath))
  useExternalDocuments(folderWorkbench.externalDocumentsReady, openMaterialDocument, setNotice, request => {
    if (request.intent?.tabs?.length) {
      const tabs = request.intent.tabs
      setLectureReportDocs(current => [...current, ...tabs.filter(tab => !current.some(doc => doc.file_path === tab.path)).map(tab => ({
        id: tab.path, file_path: tab.path, title: tab.path.split(/[\\/]/).pop() || tab.path,
        kind: "txt" as const, source: "material" as const, content: "", read_only: true, deferred: true,
      }))])
      pdf.document.setPdfPageByDocument(current => ({ ...current, ...Object.fromEntries(tabs.map(tab => [tab.path.replace(/\\/g, "/"), tab.page])) }))
    }
    if (request.intent?.page && /\.pdf$/i.test(request.path)) {
      const key = request.path.replace(/\\/g, "/")
      pdf.document.setPdfPageByDocument(current => ({ ...current, [key]: request.intent!.page! }))
      if (request.intent.zoom) pdf.view.setPdfViewZoom(request.intent.zoom)
    }
    if (request.intent?.feature) setExternalViewerFeature({ path: request.path, feature: request.intent.feature })
    if (request.intent?.handoffId) prepareViewerHandoff(request)
  })
  useDeferredDocumentOpen({ selected: selectedLectureDoc, setDocuments: setLectureReportDocs,
    open: openMaterialDocument, onNotice: setNotice })
  const handleOpenMaterialFile = useWorkspaceFileOpen(openMaterialDocument, folderWorkbench.openSourceFile, setNotice)
  const workspacePageTabs = useWorkspacePageTabs(documentWorkspace, folderWorkbench, settingsWorkflows)
  useWorkspaceTabTransfer({ workspace: documentWorkspace, workbench: folderWorkbench, editing: viewerEditing,
    activeId: workspacePageTabs.activeId, selectTab: workspacePageTabs.selectTab, settings: settingsWorkflows,
    home: homeFolderNavigation, pdf: { pages: pdfPageByDocument,
      pending: () => pdf.annotation.pdfAnnotationPendingRef.current.size,
      restorePages: pages => pdf.document.setPdfPageByDocument(current => ({ ...current, ...pages })) }, notice: setNotice })
  const navigateWorkspaceHistory = useEventCallback((target: WorkspaceNavigationEntry) => {
    if (target.surface === "dashboard") {
      documentWorkspace.actions.selectHomeTab(target.id, "home")
      if (target.folderPath !== undefined) homeFolderNavigation.restoreFolder(target.id, target.folderPath)
    } else if (target.surface === "code") {
      folderWorkbench.start()
      documentWorkspace.actions.selectHomeTab(target.id, "code")
    } else if (target.surface === "home" || target.id === "__HOME__") {
      documentWorkspace.actions.selectHomeTab(target.id, "chatbot")
    } else {
      const existing = lectureReportDocs.find((document) => document.id === target.id
        || (target.filePath && document.file_path.replace(/\\/g, "/").toLowerCase() === target.filePath.replace(/\\/g, "/").toLowerCase()))
      if (existing) documentWorkspace.actions.selectDocumentTab(existing.id)
      else if (target.filePath) return handleOpenMaterialFile(target.filePath)
    }
  })
  const isHomeWorkspace = workspaceSurface === "dashboard"
    || (!selectedLectureDocId && !viewerDocument && workspaceSurface !== "home" && workspaceSurface !== "code" && workspaceSurface !== "settings")
  const splitFolderNavigation = useWorkspaceFolderNavigation(lectureMaterials?.folders)
  const isSplitWorkspaceBrowser = folderWorkbench.activeId === SPLIT_PICKER_ID && folderWorkbench.splitPickerView === "files"
  const isFolderNavigation = isHomeWorkspace || isSplitWorkspaceBrowser
  const {
    canGoBack: canGoHistoryBack,
    canGoForward: canGoHistoryForward,
    goBack: goHistoryBack,
    goForward: goHistoryForward,
  } = useWorkspaceNavigationHistory({
    onNavigate: navigateWorkspaceHistory,
    selectedDocument: selectedLectureDoc,
    sessionDocument: sessionViewerDocument,
    workspaceSurface,
    pageTabId: documentWorkspace.documents.activeHomeTabId,
    codePageId: documentWorkspace.documents.homeTabs.some((tab) => tab.id === workspacePageTabs.activeId && tab.kind === "code")
      ? workspacePageTabs.activeId : undefined,
    homeFolderPath: homeFolderNavigation.currentFolderPath,
    onBack: isSplitWorkspaceBrowser ? splitFolderNavigation.goBack : undefined,
    onForward: isSplitWorkspaceBrowser ? splitFolderNavigation.goForward : undefined,
  })
  const canGoBack = isSplitWorkspaceBrowser ? splitFolderNavigation.canGoBack : canGoHistoryBack
  const canGoForward = isSplitWorkspaceBrowser ? splitFolderNavigation.canGoForward : canGoHistoryForward
  const handleNavBack = useEventCallback(() => {
    if (isSplitWorkspaceBrowser) splitFolderNavigation.goBack()
    else goHistoryBack()
  })
  const handleNavForward = useEventCallback(() => {
    if (isSplitWorkspaceBrowser) splitFolderNavigation.goForward()
    else goHistoryForward()
  })

  const practiceTutor = usePracticeTutorWorkspace(viewportSize,
    folderWorkbench.documentCodeActive ? practiceIdeLayout(viewportSize).width : undefined)
  const codeSandboxWorkspace = useCodeSandboxWorkspace({
    documentCodeActive: folderWorkbench.documentCodeActive,
    documentActive: workspaceSurface === "document",
    openDocumentIds: lectureReportDocs.map(document => document.id),
    tutor: practiceTutor,
    initialWorkspaceSession,
    mdSavePath: String(draftConfig.md_save_path || ""),
    mountForPath: viewerDocument && (viewerDocument.kind === "pdf" || viewerDocument.rendered_file_path)
      ? (viewerDocument.rendered_file_path || viewerDocument.file_path || "")
      : "",
    pdfViewer: {
      floating: pdfViewerFloating,
      position: pdfViewerPosition,
      setFloating: setPdfViewerFloating,
      setPosition: setPdfViewerPosition,
      setSize: setPdfViewerSize,
      size: pdfViewerSize,
    },
    setWorkspaceSurface,
    viewerDocument,
    viewportSize,
  })
  const {
    actions: {
      exitCodingMode,
      open: handleOpenCodeSandbox,
    },
    active: {
      baseDir: activeCodeSandboxBaseDir,
      fileName: activeCodeSandboxFileName,
      initialFileName: sandboxInitialFileName,
      projectName: activeCodeSandboxProjectName,
    },
    dialog: codeSandboxNameDialog,
    pathInfo: codeSandboxPathInfo,
    session: {
      latestRef: latestCodeSandboxSessionRef,
      value: codeSandboxSession,
    },
    state: {
      codingModeActive,
      keyboardCaptured: codeSandboxKeyboardCaptured,
      open: codeSandboxOpen,
    },
  } = codeSandboxWorkspace
  const pdfFullscreenOverlayOpen = viewerFullscreenOpen && !folderWorkbench.documentCodeActive && !codingModeActive
  const handleOpenDocumentPractice = useEventCallback(() => {
    if (viewerDocument?.kind === "md" && viewerDocument.file_path) {
      documentMaterialWorkspace.practice.openSolver(viewerDocument.file_path)
    } else {
      handleOpenCodeSandbox(undefined, "problems")
    }
  })
  const pdfQuickChatBlockedByWindow = Boolean(
    (settingsOpen && workspaceSurface === "settings") ||
    expertFallbackPrompt ||
    helpOpen ||
    questionHistoryOpen ||
    feedbackOpen ||
    pdfAnnotationPaletteOpen ||
    workPreflight ||
    managedAuthOpen ||
    managedCreditOpen ||
    linkedMarkdownWindow ||
    (chat.window.chatbotAnswerWindowOpen && chat.window.selectedChatbotAnswer) ||
    codeSandboxNameDialog.open ||
    pendingFileDelete ||
    pendingFolderDelete ||
    pendingBulkDelete ||
    pendingPdfPasswordPath ||
    pendingLibreOfficeFilePath ||
    practiceDialog ||
    pdfOcrConfirmPath ||
    pdfOcrFolderConfirm ||
    pdfTranslationConfirmPath,
  )
  const pdfWorkspace = usePdfWorkspaceDomain({
    interactions: {
      coding: {
        active: codingModeActive,
        exit: () => exitCodingMode(),
        keyboardCaptured: codeSandboxKeyboardCaptured,
      },
      fullscreen: pdfFullscreenOverlayOpen,
      scrollRef: viewerScrollRef,
      fullscreenScrollRef: fullscreenViewerScrollRef,
      materialFolders: lectureMaterials?.folders ?? [],
      diskSiblings,
      openMaterial: handleOpenMaterialFile,
      setFullscreen: setViewerFullscreenOpen,
    },
    overlays: {
      onCommitAnnotation: applyPdfAnnotation,
      onDeleteAnnotation: removePdfAnnotation,
    },
    practice: {
      activeSandboxBaseDir: activeCodeSandboxBaseDir,
      activeFileName: sandboxInitialFileName,
      bindOpen: pdfCore.practice.bindOpen,
      codingModeActive,
      openCodeSandbox: handleOpenCodeSandbox,
      projectName: codeSandboxPathInfo.projectName,
    },
    viewer: {
      annotationPalette: {
        containerRef: pdfAnnotationPaletteRef,
        open: pdfAnnotationPaletteOpen,
        setOpen: setPdfAnnotationPaletteOpen,
      },
      coding: {
        active: codingModeActive,
        folderOcrActive: (!codeSandboxOpen || codeSandboxWorkspace.state.alongsideIde) && folderWorkbench.folderOcrActive && folderWorkbench.ocrInsertEnabled,
        singlePageOnly: folderWorkbench.documentCodeActive,
        alongsideIde: codeSandboxWorkspace.state.alongsideIde,
        captureOcrTarget: (!codeSandboxOpen || codeSandboxWorkspace.state.alongsideIde) && folderWorkbench.folderOcrActive && folderWorkbench.ocrInsertEnabled ? folderWorkbench.captureOcrTarget : undefined,
        activeSandboxBaseDir: activeCodeSandboxBaseDir,
        sandboxOpen: codeSandboxOpen,
        setPageAspect: pdfFloatingWindow.setPdfPageAspect,
      },
      document: viewerDocument,
      pdf,
      problemBaseDir: codeSandboxPathInfo.baseDir,
      quickChat: {
        blocked: pdfQuickChatBlockedByWindow,
        draftRef: chat.input.chatInputDraftRef,
        setOpen: chat.pdf.setPdfQuickChatOpen,
      },
      resolvedTheme,
      setNotice,
    },
    workflow: {
      configuration: {
        language: appLanguage(draftConfig.language),
        localProblemReviewModel: draftConfig.local_problem_review_model,
        savedStudyRoot: String(payload?.config?.md_save_path ?? "").trim(),
      },
      document: {
        applyMaterialFile: applySavedViewerDocument,
        getViewerSource: () => viewerDocumentRef.current?.source ?? "",
        openMaterialFile: handleOpenMaterialFile,
      },
      interaction: {
        confirmWorkPreflight,
        setNotice,
      },
      materials: {
        loadFile: loadMaterialFile,
        refresh: refreshLectureMaterials,
      },
    },
  })
  const pdfViewerWorkspace = pdfWorkspace.viewer
  const {
    document: {
      activePath: activePdfPath,
      currentPage: pdfCurrentPage,
      nonSlideCodingViewer,
      pageCount: pdfPageCount,
      studyViewerActive: pdfStudyViewerActive,
      visiblePages: pdfVisiblePages,
    },
    navigation: pdfNavigation,
    ocr: {
      statusMatchesActivePath: pdfOcrStatusMatchesActivePath,
    },
  } = pdfViewerWorkspace
  const navigateEvidenceDocument = useEvidenceDocumentNavigation({
    document: viewerDocument,
    currentPage: pdfCurrentPage,
    openFile: async (path) => {
      await openMaterialDocument(path, { reload: true })
      // Reload intentionally preserves selection; explicitly activate an existing inactive tab.
      await openMaterialDocument(path)
    },
    setPages: pdf.document.setPdfPageByDocument,
    scrollRef: viewerFullscreenOpen ? fullscreenViewerScrollRef : viewerScrollRef,
  })
  const evidenceNavigation = useAnswerEvidenceNavigation({
    capture: () => {
      if (!viewerDocument?.file_path || !viewerDocument.file_path.toLowerCase().endsWith(".pdf")) return null
      const element = (viewerFullscreenOpen ? fullscreenViewerScrollRef : viewerScrollRef).current
      return { path: viewerDocument.file_path, page: latestPdfPageRef.current, scrollTop: element?.scrollTop ?? 0, scrollLeft: element?.scrollLeft ?? 0, innerScroll: captureEvidenceScroll(element) }
    },
    navigate: navigateEvidenceDocument.navigate,
    cancel: navigateEvidenceDocument.cancel,
  })
  const goToPdfPageAbsolute = pdfNavigation.goToPage
  const pdfWorkspaceWorkflows = pdfWorkspace.workflows
  const {
    ocr: {
      enqueueSelectedPdfOcr,
      handleBenchmarkPdfOcr,
      handleManualPdfOcr,
      hasAnyPdfOcrWork,
      normalizePdfOcrModelVariant,
      prepareMaterialFolderPdfOcr,
    },
    problems: {
      activePdfProblems,
      currentPdfProblems,
      handleSelectPdfProblem,
    },
    search: {
      getPdfPageText,
      handlePdfSearch,
      searchPdfDocument,
      togglePdfOutlineSection,
    },
    study: {
      bookmarkPageWithLabel,
      documentTagsByPath,
      handleOpenMaterialAtPage,
      pdfBookmarks,
      refreshPdfDocumentMetas,
      toggleCurrentPdfBookmark,
    },
    translation: {
      handleManualPdfTranslation,
    },
  } = pdfWorkspaceWorkflows
  const pdfPageOverlays = pdfWorkspace.pageOverlays
  const openMaterialSearchResult: OpenMaterialSearchResult = useEventCallback((result, context) => {
    handleOpenMaterialAtPage(result.path, result.page)
    pdf.view.setPdfSearchHighlight({ path: result.path, query: context.query })
  })
  const materialSearch = useMaterialSearchModal({
    inlineEnabled: workspaceSurface === "dashboard" || (!selectedLectureDocId && !viewerDocument
      && workspaceSurface !== "home" && workspaceSurface !== "code" && workspaceSurface !== "settings"),
    onOpenResult: openMaterialSearchResult,
  })
  const chatVoiceWorkspace = useChatVoiceWorkspace({
    practiceContext: practiceTutor.open ? practiceTutor.requestContext : null,
    onPracticeTutorFocus: practiceTutor.show,
    chat,
    codeSandboxKeyboardCaptured,
    config: {
      draft: draftConfig,
      modelOptions,
      normalize: normalizeSttConfigForEdition,
      providerOptions: options?.stt_provider_options,
      setDraft: setDraftConfig,
      setModelOptions,
      statusVoiceProvider: payload?.config?.voice_agent_provider,
    },
    document: {
      activePdfPath,
      applyMarkdownContent: applyViewerMarkdownContent,
      openDocuments: lectureReportDocs,
      currentPage: pdfCurrentPage,
      currentViewerDraft: viewerDraftContent,
      getLatestPage: () => latestPdfPageRef.current,
      getPdfPageText,
      goToPage: goToPdfPageAbsolute,
      ocrStatus: pdfFullOcrStatus,
      ocrStatusMatchesActivePath: pdfOcrStatusMatchesActivePath,
      openMaterial: handleOpenMaterialFile,
      pageCount: pdfPageCount,
      refreshMaterials: refreshLectureMaterials,
      report: selectedReport,
      requestOcr: handleManualPdfOcr,
      searchPdf: searchPdfDocument,
      selectProblem: handleSelectPdfProblem,
      selectedProblemId: selectedPdfProblemId,
      viewer: viewerDocument,
      visiblePages: pdfVisiblePages,
    },
    interaction: {
      confirmCloudPreflight: () => confirmWorkPreflight("voice_agent", {}),
      onApiError: setApiError,
      requestExpertFallback: requestExpertFallbackChoice,
      runInteraction,
      setNotice,
    },
    materials: { lectureMaterials },
    pdf: {
      hasOcrWork: hasAnyPdfOcrWork,
      problems: activePdfProblems,
    },
    sessionRef: latestWorkspaceSessionRef,
    shell: {
      chatbotVisibleOnHome: workspaceSurface === "home",
      closePractice: exitCodingMode,
      closeSettings: workspacePageTabs.closeSettings,
      codingModeActive,
      editMode: viewerEditMode,
      fullscreenOpen: viewerFullscreenOpen,
      helpOpen,
      openSettings: () => isHomeWorkspace ? workspacePageTabs.openSettings() : settingsWorkflows.open(),
      resetQuestionHistory,
      setHelpOpen,
      setMaterialsPanelOpen: learningMaterialsPanel.setOpen,
      setSurface: setWorkspaceSurface,
      settingsOpen,
      materialsPanelOpen: learningMaterialsPanel.open,
      surface: workspaceSurface,
    },
    textEntryActiveRef,
    voice,
  })
  const chatMessages = chatVoiceWorkspace.sessions.messages
  const applyExternalViewerFeature = useEventCallback((request: { path: string; feature: ExternalViewerFeature }) => {
    switch (request.feature) {
      // Office/notebook/PDF editors are already part of their normal document
      // surface. Markdown alone needs its explicit read-to-edit transition.
      case "edit": if (viewerDocument?.kind === "md") enterViewerEditMode(); break
      case "chat": chatVoiceWorkspace.window.open(); break
      case "ocr": void handleManualPdfOcr(request.path); break
      case "home": workspacePageTabs.goHome(); break
      case "new-tab": handleNewTab(); break
      case "materials": learningMaterialsPanel.setOpen(true); break
      case "work-queue": setBackgroundWorkQueueOpen(true); break
      case "practice": handleOpenDocumentPractice(); break
      case "bookmarks": setPdfBookmarkDialog({ open: true, tab: "add" }); break
      case "history": questionHistory.openHistory(); break
      case "code": folderWorkbench.startWithDocument(viewerDocument); break
      case "feedback": setFeedbackOpen(true); break
      case "search": pdf.view.setPdfTextToolsOpen(true); break
      // The compact launcher owns its lazy dialog and also exposes this stable
      // target to the regular Ctrl+I shortcut.
      case "insight": document.querySelector<HTMLButtonElement>('[data-ails-insight-shortcut="true"]')?.click(); break
    }
  })
  const handleDropChatAnswer = chatVoiceWorkspace.answers.saveAnswer
  const chatRequestWorkflows = chatVoiceWorkspace.requests
  const handleAskChatbot = chatRequestWorkflows.askChatbot
  const handleAskHighlightedText = chatRequestWorkflows.prepareHighlightedText
  const handleToggleAiAssist = chatRequestWorkflows.toggleAiAssist
  const markdownOpenLocalHandler = useEventCallback((href: string, event?: ReactMouseEvent<HTMLElement>) => {
    const backgroundOpen = Boolean(event && (event.button === 1 || ((event.ctrlKey || event.metaKey) && !event.shiftKey)))
    const foregroundOpen = Boolean(event && (event.ctrlKey || event.metaKey) && event.shiftKey)
    const newWindowOpen = Boolean(event && event.button === 0 && event.shiftKey && !event.ctrlKey && !event.metaKey)
    if (!backgroundOpen && !foregroundOpen && !newWindowOpen) {
      void handleOpenLinkedMarkdown(href)
      return
    }
    const path = new URL(href, window.location.origin).searchParams.get("path")
    if (!path) {
      void handleOpenLinkedMarkdown(href)
      return
    }
    if (newWindowOpen) {
      const desktop = (window as Window & { ailsDesktop?: { api?: { open_split_window?: (path: string) => Promise<boolean> } } }).ailsDesktop?.api
      if (desktop?.open_split_window) void desktop.open_split_window(path)
      else window.open(`/?openMaterial=${encodeURIComponent(path)}`, "_blank")
      return
    }
    if (foregroundOpen) void handleOpenMaterialFile(path, { newTab: true })
    else void handleOpenMaterialFileInBackground(path)
  })
  const markdownAskHighlightedTextHandler = useEventCallback((text: string) => {
    void handleAskHighlightedText(text)
  })
  const commitPdfChatDraft = chatVoiceWorkspace.draft.commit
  const handlePdfChatDraftChange = chatVoiceWorkspace.draft.onChange
  const chatWindowWorkflows = chatVoiceWorkspace.window
  const voiceSessionWorkflows = chatVoiceWorkspace.voiceSession
  const handleStartVoice = voiceSessionWorkflows.start
  const voiceError = voice.state.voiceError
  const { aiAssistBusy, aiAssistEnabled } = chat.assist
  const { draggedChatAnswerId, dropPreview, droppedAnswerLinks, setDropPreview } = chat.drag
  const { chatInputDraft, chatInputDraftRef } = chat.input
  const {
    chatbotAnswerWindowOpen,
    chatbotWindowOpen,
    selectedChatbotAnswer,
    setChatbotAnswerWindowOpen,
    setSelectedChatbotAnswer,
  } = chat.window
  const notebook = useNotebookWorkspace({
    applySavedDocument: applySavedViewerDocument,
    busyActions,
    document: viewerDocument,
    refreshMaterials: refreshLectureMaterials,
    runInteraction,
    setDocuments: setLectureReportDocs,
    setNotice,
    setSelectedReport,
  })

  useWorkspaceSessionPersistence({
    chat: {
      draft: chatInputDraft,
      draftRef: chatInputDraftRef,
      open: chatbotWindowOpen,
    },
    codeSandbox: {
      activeFileName: activeCodeSandboxFileName,
      baseDir: activeCodeSandboxBaseDir,
      latestRef: latestCodeSandboxSessionRef,
      open: codeSandboxOpen,
      projectName: activeCodeSandboxProjectName,
      session: codeSandboxSession,
    },
    latestSessionRef: latestWorkspaceSessionRef,
    layout: { leftSidebarWidth: initialWorkspaceSession?.layout?.leftSidebarWidth ?? 292 },
    pdfPage: pdfCurrentPage,
    pdfViewer: {
      floating: pdfViewerFloating,
      position: pdfViewerPosition,
      size: pdfViewerSize,
    },
    viewer: {
      document: viewerDocument,
      fullscreenOpen: viewerFullscreenOpen,
    },
  })



  const handleBrowserRefresh = useEventCallback((forced: boolean) => {
    if (forced || workspaceSurface !== "document" || !viewerDocumentRef.current?.file_path) {
      void runInteraction("refresh", t("목록 갱신"), async () => {
        await Promise.all([
          refresh({ scanDisk: true }),
          refreshLectureMaterials(),
        ])
        return t("목록을 갱신했습니다.")
      })
    }
    const filePath = viewerDocumentRef.current?.file_path
    if (workspaceSurface === "document" && filePath) void handleOpenMaterialFile(filePath, { reload: true })
  })
  const handleBrowserPdfZoom = useEventCallback((direction: 1 | -1) => {
    if (!pdfStudyViewerActive) return
    const next = Math.round(
      normalizePdfViewZoom(pdf.view.pdfViewZoomRef.current + direction * PDF_VIEW_ZOOM_STEP) * 100,
    ) / 100
    pdf.view.setPdfViewZoom(next)
    localStorage.setItem("ails_pdf_view_zoom", String(next))
  })
  const handleBrowserPdfZoomReset = useEventCallback(() => {
    if (!pdfStudyViewerActive) return
    pdf.view.setPdfViewZoom(1)
    localStorage.setItem("ails_pdf_view_zoom", "1")
  })
  const handleBrowserPdfSearch = useEventCallback(() => {
    if (!activePdfPath) return
    if (practiceTutor.open && practiceTutor.context?.source_kind === "pdf") practiceTutor.setTab("pdf")
    pdf.view.setPdfTextToolsOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById("ails-pdf-search-input")?.focus()
    })
  })
  const handleBrowserPdfBookmark = useEventCallback(() => {
    if (!pdfStudyViewerActive) return
    toggleCurrentPdfBookmark()
  })
  const handleBrowserCloseActiveTab = workspacePageTabs.closeActive
  const handleBrowserReopenClosedTab = useEventCallback(() => {
    const entry = documentWorkspace.actions.takeClosedTab()
    if (!entry?.file_path) return
    void handleOpenMaterialFile(entry.file_path, { newTab: true })
  })

  const processBarTabs = documentWorkspace.actions.orderTabs(folderWorkbench.tabs)
  const documentFind = useDocumentFind({
    active: workspaceSurface === "document", document: viewerDocument, editing: viewerEditMode,
    fullscreen: viewerFullscreenOpen, primaryRef: viewerScrollRef, fullscreenRef: fullscreenViewerScrollRef,
  })
  useAppKeyboardShortcuts({
    chat: {
      ask: handleAskChatbot,
      commitDraft: commitPdfChatDraft,
      controller: chat,
      toggleWindow: () => chatWindowWorkflows.toggle(),
    },
    codeSandbox: {
      keyboardCaptured: codeSandboxKeyboardCaptured,
      open: handleOpenDocumentPractice,
    },
    hintMode,
    materials: {
      openFile: async () => {
        try {
          const result = await openFileDialog({ kind: "document", title: t("자료 파일 열기"), initial_dir: String(draftConfig.md_save_path ?? "") })
          if (result.path) await handleOpenMaterialFile(result.path)
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error))
        }
      },
      documents: folderWorkbench.tabs.filter((tab) => tab.kind !== "split-picker"),
      scrollRef: lectureMaterialsScrollRef,
      selectedDocumentId: folderWorkbench.activeId,
      selectDocument: folderWorkbench.select,
    },
    navigation: {
      back: handleNavBack,
      canGoBack,
      canGoForward,
      forward: handleNavForward,
    },
    pdf: {
      bookmarkCurrent: handleBrowserPdfBookmark,
      openSearch: handleBrowserPdfSearch,
      quickChatBlockedByWindow: pdfQuickChatBlockedByWindow,
      redoAnnotation: redoPdfAnnotation,
      studyViewerActive: pdfStudyViewerActive,
      undoAnnotation: undoPdfAnnotation,
      zoomIn: () => handleBrowserPdfZoom(1),
      zoomOut: () => handleBrowserPdfZoom(-1),
      zoomReset: handleBrowserPdfZoomReset,
    },
    refresh: {
      current: () => void handleBrowserRefresh(false),
      forced: () => void handleBrowserRefresh(true),
    },
    tabs: {
      closeActive: handleBrowserCloseActiveTab,
      openNew: handleNewTab,
      reopenLastClosed: handleBrowserReopenClosedTab,
      items: processBarTabs.filter((tab) => tab.kind !== "split-picker"),
      activeId: workspacePageTabs.activeId,
      selectTab: workspacePageTabs.selectTab,
    },
    searchModal: {
      handleKeyDown: materialSearch.handleKeyDown,
      open: materialSearch.isOpen && materialSearch.presentation === "modal",
      toggle: () => {
        if (!focusInlineMaterialSearch()) materialSearch.toggle()
      },
    },
    viewer: {
      document: viewerDocument,
      editingTextareaRef: editingTextareaRef,
      editMode: viewerEditMode,
      enterEditMode: enterViewerEditMode,
      fullscreen: viewerFullscreenOpen,
      fullscreenScrollRef: fullscreenViewerScrollRef,
      leaveEditMode: leaveViewerEditMode,
      primaryScrollRef: viewerScrollRef,
      openSearch: documentFind.show,
      redoDirectly: redoViewerDirectly,
      redoDraft: redoViewerDraft,
      removeTopVisibleImage,
      undoDirectly: undoViewerDirectly,
      undoDraft: undoViewerDraft,
    },
    workspaceSurface,
    homeWorkspaceActive: isHomeWorkspace,
  })

  function chatWorkspaceView(mode: "home" | "fullscreen" | "tutor", showComposer = true) {
    const props = {
      busy: isBusy,
      controller: chatVoiceWorkspace,
      showComposer,
      models: { config: draftConfig, options: modelOptions },
      onOpenMaterialFile: handleOpenMaterialFile,
      workspace: {
        onOpenDocument: setSelectedLectureDocId,
        onSetSurface: setWorkspaceSurface,
        onShowMaterials: setLectureAddExpanded,
        recentFiles,
        setNotice,
      },
    }
    return mode === "tutor" ? <PracticeTutorChatWorkspaceView {...props} /> : <ChatWorkspaceView {...props} mode={mode} />
  }

  return (
    <I18nContext.Provider value={{ version: i18nVersion }}>
    <EvidenceNavigationContext.Provider value={evidenceNavigation}>
    <PracticeTutorProvider value={practiceTutor}>
    <div
      className="flex h-dvh min-h-[min(420px,100dvh)] flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
      ref={appThemeRootRef}
      style={themeVars}
    >
      {editionIntegrityError && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 p-6">
          <div className="max-w-xl rounded-xl border border-red-400/50 bg-[var(--card)] p-5 text-[var(--foreground)] shadow-2xl">
            <div className="text-base font-semibold text-red-500">Edition integrity error</div>
            <div className="mt-2 break-words text-sm">{editionIntegrityError}</div>
          </div>
        </div>
      )}
      <DesktopTitleBarWorkspace
        actions={{
          clearVoiceError: voiceSessionWorkflows.clearError,
          closeTab: workspacePageTabs.closeTab,
          goBack: handleNavBack,
          goForward: handleNavForward,
          goHome: workspacePageTabs.goHome,
          newTab: handleNewTab,
          openBookmarks: () => setPdfBookmarkDialog({ open: true, tab: "add" }),
          openCodePractice: () => folderWorkbench.startWithDocument(viewerDocument),
          openFeedback: () => setFeedbackOpen(true),
          openQuestionHistory: questionHistory.openHistory,
          selectTab: folderWorkbench.select,
          setFullscreen: setViewerFullscreenOpen,
          toggleMaximizedFallback: () => setIsMaximized((value) => !value),
        }}
        fullscreen={viewerFullscreenOpen}
        fullscreenOnMaximize={appearance.fullscreenOnMaximize}
        backgroundWork={{
          count: (backendWorkStatus.activeTasks.length + backendWorkStatus.pending.length || (backendWorkStatus.currentStatus?.is_running ? 1 : 0)) + updateWork.workCount,
          open: () => setBackgroundWorkQueueOpen(true),
        }}
        learning={workspaceSurface === "document" ? {
          assist: { busy: aiAssistBusy, enabled: aiAssistEnabled, modelLabel: aiAssistModelLabel, toggle: handleToggleAiAssist },
          materialsOpen: learningMaterialsPanel.open,
          toggleMaterials: learningMaterialsPanel.toggle,
          openWorkQueue: () => setBackgroundWorkQueueOpen(true),
        } : undefined}
        insight={viewerDocument && workspaceSurface === "document" ? {
          accountKey: `${managedAuthStatus?.authenticated ? "signed-in" : "signed-out"}:${managedAuthStatus?.email || ""}:${managedAuthStatus?.server_url || ""}`,
          materialRoot: draftConfig.md_save_path || "",
          onOpenSource: (path, page) => {
            if (page) handleOpenMaterialAtPage(path, page)
            else void handleOpenMaterialFile(path)
          },
        } : undefined}
        isMaximized={isMaximized}
        localAiSettingsEnabled={LOCAL_AI_SETTINGS_ENABLED}
        navigation={{
          activeHomeTabId: documentWorkspace.documents.activeHomeTabId,
          activeDocId: workspacePageTabs.activeId,
          canGoBack,
          canGoForward,
          isHome: isHomeWorkspace,
          isFolderNavigation,
          tabs: processBarTabs,
          onCloseHomeTab: workspacePageTabs.closePageTab,
          canCloseLastTab: workspacePageTabs.canCloseLastTab,
          onSelectHomeTab: workspacePageTabs.selectTab,
          splitIds: folderWorkbench.split ?? undefined,
          splitGroups: folderWorkbench.splitGroups,
          onSplitTab: folderWorkbench.splitWith,
          onUnsplitTab: folderWorkbench.unsplit,
          onReorderTabs: documentWorkspace.actions.reorderTabs,
        }}
        onResizeMouseDown={handleAppWindowResizeMouseDown}
        pdf={{ core: pdfCore, detection: documentDetection, uiLanguage: getUiLanguage(), workspace: pdfWorkspace }}
        practice={viewerDocument && workspaceSurface !== "dashboard" && (viewerDocument.kind === "md" || viewerDocument.kind === "pdf") ? { open: handleOpenDocumentPractice } : undefined}
        questionHistoryVisible={Boolean(viewerDocument && workspaceSurface !== "dashboard")}
        codeVisible={Boolean(viewerDocument && workspaceSurface !== "dashboard")}
        voiceError={voiceError}
      />
      <DocumentFindBar controller={documentFind} />
      <DocumentMaterialOverlays
        backendStatus={backendWorkStatus}
        busy={isBusy}
        controller={materials}
        documentWorkspace={documentMaterialWorkspace}
        interaction={{
          generationNotices,
          refresh,
          runInteraction,
          setGenerationNotices,
        }}
        ocrExcludedPaths={draftConfig.background_document_ocr_excluded_paths}
        ocrWorkBusy={Boolean(hasAnyPdfOcrWork || pdfOcrBenchmarkProgress)}
        onDeviceReauthenticate={(title) => {
          pendingDeviceRetryRef.current = {
            title,
            email: String(managedAuthStatus?.email || draftConfig.ails_auth_email || "").trim().toLocaleLowerCase(),
          }
          managedAccount.openManagedAuthDialog()
        }}
        pdf={pdf}
        summary={summaryGeneration}
        tasks={taskOperations}
      />
      <div className="relative isolate flex min-h-0 flex-1 min-w-0 text-[length:var(--app-font-size)] bg-[var(--sidebar)]">
        <LearningMaterialsPanel
          open={learningMaterialsPanel.open}
          onClose={learningMaterialsPanel.close}
          scrollRef={lectureMaterialsScrollRef}
          workflows={materialWorkflows}
          browser={{
            busyActions, controller: materials, isBusy,
            ocrExcludedPaths: draftConfig.background_document_ocr_excluded_paths,
            onNotice: setNotice, onOpenFile: (path) => { learningMaterialsPanel.close(); void handleOpenMaterialFile(path) },
            onGenerateFilePractice: documentMaterialWorkspace.practice.generateForFile,
            onSolvePractice: documentMaterialWorkspace.practice.openSolver,
          }}
        />
        <WorkspaceSurfaceContent
          dashboardTabs={{
            activeId: documentWorkspace.documents.activeHomeTabId,
            openIds: documentWorkspace.documents.cachedHomeTabIds,
          }}
          workbench={{
            practiceReservedWidth: codeSandboxWorkspace.state.reservedWidth,
            controller: folderWorkbench,
            documents: lectureReportDocs,
            documentId: selectedLectureDocId,
            pdfPages: pdfPageByDocument,
            onPdfPageChange: (document, page) => pdf.document.setPdfPageByDocument((current) => ({ ...current, [document.file_path.replace(/\\/g, "/")]: page })),
          }}
          dashboard={{
            splitFolderNavigation: { folderPath: splitFolderNavigation.currentFolderPath, navigateToFolder: splitFolderNavigation.navigateToFolder },
            accountKey: `${managedAuthStatus?.authenticated ? "signed-in" : "signed-out"}:${managedAuthStatus?.email || ""}:${managedAuthStatus?.server_url || ""}`,
            activity: { busyActions, isBusy, runInteraction, setNotice },
            materials,
            navigation: {
              onBackToAgent: () => {
                setSelectedLectureDocId("")
                setSelectedReportId("")
                setSelectedReport(null)
                setWorkspaceSurface("document")
              },
              openFile: handleOpenMaterialFile,
              folderPath: homeFolderNavigation.currentFolderPath,
              navigateToFolder: homeFolderNavigation.navigateToFolder,
            },
            ocr: {
              excludedPaths: draftConfig.background_document_ocr_excluded_paths,
              toggleExclusion: handleToggleOcrExclusion,
            },
            pdf: {
              documentTags: documentTagsByPath,
              onDocumentMetaChanged: () => void refreshPdfDocumentMetas(),
              onOpenAtPage: handleOpenMaterialAtPage,
              pageByDocument: pdfPageByDocument,
              activeOcrJobs: pdfCore.controller.ocr.pdfOcrJobs,
            },
            quickActions: {
              openCode: workspacePageTabs.openCode,
              openFolder: () => { void folderWorkbench.openFolder(false) },
              openFile: (path) => void handleOpenMaterialFile(path),
              openHelp: () => setHelpOpen(true),
              openPractice: documentMaterialWorkspace.practice.generateForAll,
              openSettings: workspacePageTabs.openSettings,
              openSummary: () => setLectureAddExpanded(true),
              openChatbot: workspacePageTabs.openChatbot,
              openWorkQueue: () => setBackgroundWorkQueueOpen(true),
              runOcr: (path) => void enqueueSelectedPdfOcr(path),
              runTranslation: (path) => {
                void handleOpenMaterialFile(path)
                handleManualPdfTranslation(path)
              },
            },
            mdSavePath: String(draftConfig.md_save_path ?? ""),
            onGenerateFilePractice: documentMaterialWorkspace.practice.generateForFile,
            onSolvePractice: documentMaterialWorkspace.practice.openSolver,
            recentFiles,
            search: {
              controller: materialSearch,
              onOpenResult: openMaterialSearchResult,
            },
            workflows: materialWorkflows,
          }}
          document={{
            available: Boolean(selectedLectureDocId || viewerDocument),
            chat: {
              panel: chatWorkspaceView("fullscreen", !isHomeWorkspace),
              visible: chatbotWindowOpen && !pdfFullscreenOverlayOpen && !practiceTutor.open,
            },
            layout: {
              lectureAddExpanded,
              nonSlideCodingViewer,
              onAutoCollapseLectureAdd: () => {
                setLectureAddExpanded(false)
                setNotice(t("새 강의 추가 섹션을 자동으로 접었습니다."))
              },
              pdfStudyViewerActive,
            },
            toolbar: {
              apiError,
              isLatexPostprocessBusy: isBusy("latex-postprocess"),
              isRefreshBusy: isBusy("refresh"),
              notice,
              onLatexPostprocess: () => void handleLatexPostprocess(),
              onOpenHelp: () => setHelpOpen(true),
              onRefresh: () => {
                void runInteraction("refresh", t("목록 갱신"), async () => {
                  await Promise.all([
                    refresh({ scanDisk: true }),
                    refreshLectureMaterials(),
                  ])
                  return t("목록을 갱신했습니다.")
                })
              },
            },
            viewer: {
              document: viewerDocument,
              drag: {
                draggedAnswerId: draggedChatAnswerId,
                droppedLinks: droppedAnswerLinks,
                getActiveDraggedAnswerId: chatWindowWorkflows.getActiveDraggedAnswerId,
                messages: chatMessages,
                onSaveAnswer: handleDropChatAnswer,
                preview: dropPreview,
                restoreAfterAnswerDrag: chatWindowWorkflows.restoreAfterAnswerDrag,
                setPreview: setDropPreview,
                updatePreview: chatWindowWorkflows.updateDropPreview,
              },
              editing: {
                active: viewerEditMode,
                previewPending: viewerPreviewPending,
                editor: viewerMarkdownEditor,
                enter: enterViewerEditMode,
                keyDown: handleViewerEditKeyDown,
                leave: leaveViewerEditMode,
              },
              markdown: {
                onAskHighlightedText: markdownAskHighlightedTextHandler,
                onHighlightText: markdownHighlightTextHandler,
                onImageDoubleClick: markdownImageDoubleClickHandler,
                onOpenLocal: markdownOpenLocalHandler,
              },
              materials: lectureMaterials,
              menu: {
                onOpenFullscreen: () => setViewerFullscreenOpen(true),
                onRunLatexPostprocess: () => void handleLatexPostprocess(),
                open: mdMoreMenuOpen,
                setNotice,
                setOpen: setMdMoreMenuOpen,
              },
              notebook,
              pdf: {
                Viewer: PdfWorkspaceViewer,
                controller: pdf,
                floating: pdfFloatingWindow,
                fullscreenOpen: pdfFullscreenOverlayOpen,
                overlay: pdfPageOverlays.viewer,
                problems: {
                  current: currentPdfProblems,
                  onSelect: handleSelectPdfProblem,
                },
                textTools: {
                  onSearch: handlePdfSearch,
                  onToggleSection: togglePdfOutlineSection,
                },
                workspace: pdfViewerWorkspace,
              },
            },
          }}
          home={{
            agent: chatWorkspaceView("home"),
            onOpenDashboard: () => {
              setSelectedLectureDocId("")
              setSelectedReportId("")
              setSelectedReport(null)
              setWorkspaceSurface("document")
            },
          }}
          mainScrollRef={mainScrollRef}
          paneRef={viewerPaneRef}
          surface={workspaceSurface}
          topRef={workspaceTopRef}
          viewerScrollRef={viewerScrollRef}
        />
      </div>

      <PdfWorkspaceOverlays
        active={workspaceSurface === "document"}
        homeQuickChat={isHomeWorkspace && !pdfQuickChatBlockedByWindow}
        chat={{
          blocked: pdfQuickChatBlockedByWindow || codingModeActive || codeSandboxKeyboardCaptured,
          canToggleWindow: () => !isHomeWorkspace || !homeWorkspaceHasSelection(),
          commitDraft: commitPdfChatDraft,
          controller: chat,
          onAsk: handleAskChatbot,
          onStop: chatRequestWorkflows.stopAnswer,
          onDraftChange: handlePdfChatDraftChange,
          panel: chatWorkspaceView("fullscreen"),
          usageIndicator: <ChatGPTPlanIndicatorForConfig config={draftConfig} busy={isBusy("chatbot-ask")} onError={setNotice} />,
          reasoningControl: <ChatComposerControls config={draftConfig} options={modelOptions} reasoning={chat.input.chatReasoningEffort}
            active={chat.pdf.pdfQuickChatOpen || voice.state.voiceState !== "idle"}
            onReasoningChange={chat.input.setChatReasoningEffort} onModelChange={chatRequestWorkflows.changeAgentModel}
            busy={isBusy("chatbot-ask")} savingModel={isBusy("chatbot-agent-model-save")} reasoningDisabled={!chatVoiceWorkspace.reasoningAvailable} requireTools={chat.assist.aiAssistEnabled} />,
          toggleWindow: () => isHomeWorkspace ? chatWindowWorkflows.open() : chatWindowWorkflows.toggle(),
        }}
        codeSandbox={{
          Overlay: CodeSandboxWorkspaceOverlay,
          pdfFileNavigation: pdfWorkspace.practicePdfNavigation,
          pdfViewerFloating,
          workspace: codeSandboxWorkspace,
        }}
        document={{
          fullscreenOpen: pdfFullscreenOverlayOpen,
          editing: {active:viewerEditMode, editor:viewerEditing.editor, enter:enterViewerEditMode, leave:leaveViewerEditMode},
          menu: {open:mdMoreMenuOpen, fullscreen:true, setOpen:setMdMoreMenuOpen, setNotice,
            onOpenFullscreen:() => setViewerFullscreenOpen(false), onRunLatexPostprocess:() => void handleLatexPostprocess()},
          markdown: {
            onAskHighlightedText: markdownAskHighlightedTextHandler,
            onHighlightText: markdownHighlightTextHandler,
            onImageDoubleClick: markdownImageDoubleClickHandler,
            onOpenLocal: markdownOpenLocalHandler,
          },
          notebook,
          viewer: viewerDocument,
        }}
        isBusy={isBusy}
        materialDialogs={
          <MaterialDocumentDialogs isBusy={isBusy} mode="linked" pdf={pdf} workflow={materialDocumentWorkflows} />
        }
        pdf={{
          controller: pdf,
          pageOverlays: pdfPageOverlays,
          viewer: pdfViewerWorkspace,
          workflows: pdfWorkspaceWorkflows,
        }}
        questionHistory={questionHistory}
        voice={{ controller: voice, onStart: handleStartVoice }}
        workflowContext={{
          language: draftConfig.language,
          managedCloudReady: Boolean(managedAuthStatus?.authenticated && managedAuthStatus?.credits),
        }}
      />

      <HelpDialog
        localAiSettingsEnabled={LOCAL_AI_SETTINGS_ENABLED}
        onClose={() => setHelpOpen(false)}
        open={helpOpen}
        summarySttEnabled={SUMMARY_STT_ENABLED}
      />

      {/* @ails-feature:developer_tools:start */}
      <DeveloperToolsOnboarding />
      {/* @ails-feature:developer_tools:end */}
      <AIConsentGate />
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      <PdfBookmarkDialog
        activeTab={pdfBookmarkDialog.tab}
        bookmarks={pdfBookmarks}
        currentPage={pdfCurrentPage}
        onClose={() => setPdfBookmarkDialog((current) => ({ ...current, open: false }))}
        onDelete={(page) => bookmarkPageWithLabel(page, "")}
        onGoToPage={goToPdfPageAbsolute}
        onSave={(page, label) => bookmarkPageWithLabel(page, label)}
        onTabChange={(tab) => setPdfBookmarkDialog((current) => ({ ...current, tab }))}
        open={pdfBookmarkDialog.open}
        pageCount={pdfPageCount}
        pdfPath={activePdfPath}
      />
      <BackgroundWorkQueueDialog
        activeOperations={<UpdateBackgroundTask status={updateWork.status} />}
        activeOperationCount={updateWork.workCount}
        documentOperations={<PdfOcrTaskList ocr={pdfCore.controller.ocr} actions={pdfWorkspace.workflows.ocr} />}
        documentOperationCount={pdfCore.controller.ocr.pdfOcrJobs.length || (pdfCore.controller.ocr.pdfFullOcrProgress || pdfCore.controller.ocr.pdfOcrBenchmarkProgress ? 1 : 0)}
        documentation={{ status: backendWorkStatus, actions: taskOperations, isBusy, refresh }}
        open={backgroundWorkQueueOpen}
        onClose={closeBackgroundWorkQueue}
        onToggleOcrExclusion={(targetPath) => void handleToggleOcrExclusion(targetPath)}
        excludedPaths={draftConfig.background_document_ocr_excluded_paths}
      />
      <MaterialSearchModal controller={materialSearch} />

      <WorkPreflightDialog
        onResolve={resolveWorkPreflight}
        preflight={workPreflight}
        showRoute={LOCAL_AI_SETTINGS_ENABLED}
      />

      <ManagedAccountDialogs account={managedAccount} isBusy={isBusy} />
      <ExpertFallbackDialog
        onResolve={resolveExpertFallbackChoice}
        prompt={expertFallbackPrompt}
        recommendedModelName={expertFallbackPrompt
          ? chatbotModelName(expertFallbackPrompt.recommendedModel, modelOptions?.chatbot_expert_models)
          : ""}
        selectedModelName={expertFallbackPrompt
          ? chatbotModelName(expertFallbackPrompt.selectedModel, modelOptions?.chatbot_expert_models)
          : ""}
      />

      {settingsOpen && <SettingsSurface
        account={managedAccount}
        actions={{
          benchmarkPdfOcr: handleBenchmarkPdfOcr,
          copyDebugTrace: debugTrace.copy,
          navigatePdf: goToPdfPageAbsolute,
          normalizePdfOcrModelVariant,
          openBackgroundQueue: () => setBackgroundWorkQueueOpen(true),
          openDistributionLicenses: handleOpenDistributionLicenses,
          pickPythonExecutable: handlePickPythonExecutable,
          pickSaveDirectory: handlePickSaveDirectory,
          refreshPythonRuntime,
      /* @ails-feature:summary.web_inputs:start */
          saveLmsCredentials: handleSaveLmsCredentials,
      /* @ails-feature:summary.web_inputs:end */
          searchPdf: handlePdfSearch,
          togglePdfOutlineSection,
        }}
        active={settingsOpen && workspaceSurface === "settings"}
        appearance={appearance}
        debugTrace={debugTrace}
        isBusy={isBusy}
        metadata={{ managedAiPolicy, managedAiPolicyError, phoenixStatus }}
        options={options}
        pdf={pdf}
        settings={settings}
        setNotice={setNotice}
        workflows={{ ...settingsWorkflows, close: workspacePageTabs.closeSettings }}
      />}

      {/* @ails-feature:developer_tools:start */}
      {DEVELOPER_TOOLS_ENABLED && (
        <DebugTraceWindow isBusy={isBusy} viewportSize={viewportSize} workflow={debugTrace} />
      )}
      {/* @ails-feature:developer_tools:end */}
      <UpdateNotice onOpenSettings={() => isHomeWorkspace ? workspacePageTabs.openSettings() : settingsWorkflows.open()} />
      <HintOverlay hintMode={hintMode} />
      {chatbotAnswerWindowOpen && selectedChatbotAnswer && (
        <ChatAnswerWindow
          body={<><ChatAnswerMarkdown content={selectedChatbotAnswer.content} /><ChatAnswerEvidence evidence={selectedChatbotAnswer.evidence} /></>}
          message={selectedChatbotAnswer}
          onClose={() => {
            setChatbotAnswerWindowOpen(false)
            setSelectedChatbotAnswer(null)
          }}
        />
      )}
      <EvidenceReturnBar />
      <PracticeTutorDock>{chatWorkspaceView("tutor")}</PracticeTutorDock>
    </div>
    </PracticeTutorProvider>
    </EvidenceNavigationContext.Provider>
    </I18nContext.Provider>
  )
}

export default App
