import { useCodeEditorPreferences } from "../hooks/use-code-editor-preferences.ts"
import { useCodeEditorAnnotations } from "../hooks/use-code-editor-annotations.ts"
import { useCodeProjectMutations } from "../hooks/use-code-project-mutations.ts"
import { useCodeAiReview } from "../hooks/use-code-ai-review.ts"
import { createCodeEditorMountHandlers } from "../lib/code-editor-mount.ts"
import { readCodeProjectDraft } from "../lib/code-project-draft-storage.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { CodeSettingsPanel } from "./code-settings-panel.tsx"
import { PracticeAnswerPanel } from "./practice-answer-panel.tsx"
import { PracticeQuestionCopyButton } from "./practice-question-copy-button.tsx"
import { PracticeCodeFiles } from "./practice-code-files.tsx"
import { PracticeGradingContext } from "../../practice-grading/components/practice-grading-context.tsx"
import { usePdfPracticeTutor } from "../../practice-tutor/hooks/use-pdf-practice-tutor.ts"
import { usePracticeNavigationFold } from "../hooks/use-practice-navigation-fold.ts"
import { PracticeTutorEntry } from "../../practice-tutor/components/practice-tutor-entry.tsx"
import { CodeExecutionResultPanel } from "./code-execution-result-panel.tsx"
import { CodeProjectSidebar } from "./code-project-sidebar.tsx"
import { CodeWindowToolbar } from "./code-window-toolbar.tsx"
import { AnswerKeyControl } from "./answer-key-control.tsx"
import { PracticeStudyHeader } from "./practice-study-header.tsx"
import { usePracticeClose } from "../hooks/use-practice-close.ts"
import { PracticeRoundHistory } from "./practice-round-history.tsx"
import { PracticeRetryControls } from "./practice-retry-controls.tsx"
import { loadPdfProblemHistory } from "../../../lib/api.ts"
import { ProblemBatchProgressPanel } from "./problem-batch-progress-panel.tsx"
import { useCodePracticeActions } from "../hooks/use-code-practice-actions.ts"
import { practiceNavigationDirection, usePracticeNavigation } from "../hooks/use-practice-navigation.ts"
import { usePracticePdfFiles, type PracticePdfFileNavigation } from "../hooks/use-practice-pdf-files.ts"
import { t } from "../../../lib/i18n.ts"
import { memo, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react"
import { PracticeEmptyState } from "./practice-empty-state.tsx"
import Editor from "@monaco-editor/react"
import { workspaceEditorScrollbar } from "../../../shared/ui/workspace-scrollbars.ts"
import type * as Monaco from "monaco-editor"
import "../lib/monaco-loader.ts"
import { useTheme } from "next-themes"
import { Folder, Plus, RefreshCw, RotateCcw } from "lucide-react"

import { getCodeProjectFiles, promptEditCodeSandbox, getLanguageProfiles, type LanguageProfile, type PdfProblem, type PdfProblemAutoReviewStatus } from "../../../lib/api"
/* @ails-feature:developer_tools:start */

import { ProblemEditDialog } from "./problem-edit-dialog.tsx"
import { ProblemReviewQueueDialog } from "./problem-review-queue-dialog.tsx"

/* @ails-feature:developer_tools:end */
import { PracticeFeedbackPanel, PracticeHintPanel } from "./practice-feedback-panels.tsx"

import { DEVELOPER_TOOLS_ENABLED, IDE_ENABLED } from "../../../edition.ts"
import { type CompilerDiagnostic } from "../lib/compiler-diagnostics.ts"
import { customSyntaxTheme, syncCustomLanguageSyntax } from "../lib/custom-language-syntax.ts"

import { useCodeSandboxWindowChrome } from "../hooks/use-code-sandbox-window-chrome.ts"
import { useCodeExecutionConsole } from "../hooks/use-code-execution-console.ts"
import { useCodePracticeProblems } from "../hooks/use-code-practice-problems.ts"
import { useCodeProjectDrafts } from "../hooks/use-code-project-drafts.ts"
import { useCodeProjectFiles } from "../hooks/use-code-project-files.ts"
import { useCodeProjectIndex } from "../hooks/use-code-project-index.ts"

import { buildProjectBrowserEntries, normalizeProjectPath, parentProjectPath, projectBaseName } from "../lib/code-project-browser.ts"
import { CODE_SHORTCUT_DEFINITIONS, shortcutMatchesEvent, type CodeShortcutAction } from "../lib/code-shortcuts.ts"

import { codeProjectLoadScope, consoleErrorMessage, detectLanguageFromExtension, fallbackTemplate, isMonacoEditorElement, isProblemMetadataFile, isTextEntryElement, monacoLanguageForFile, parentFolder, projectPathForPdfProblem, readPersistedTemplate, trimExtractedCodeBlock, writePersistedTemplate, type CodeRunSnapshot, type SandboxFile } from "../lib/code-sandbox-support.ts"
import { codeSandboxResizeCursor } from "../code-sandbox-window-geometry.ts"

// Re-exported for the dynamic importer and existing consumers of this module.
export type { SandboxFile } from "../lib/code-sandbox-support.ts"

interface CodeSandboxWindowProps {
  isOpen: boolean
  onClose: () => void
  /** 문제풀이("problems")로 열렸는지, 독립 코드 에디터("code")로 열렸는지. */
  windowMode?: "problems" | "code"
  baseDir: string
  initialProjectName: string
  initialFileName: string
  initialActiveFileName?: string
  ocrInsertRequest?: { id: number; text: string; page: number } | null
  pdfPath?: string
  problemBaseDir?: string
  problems?: PdfProblem[]
  problemReviewQueueRefreshKey?: string
  problemAutoReviewStatus?: PdfProblemAutoReviewStatus | null
  onReviewAllProblems?: () => void | Promise<void>
  onReviewAllProblemsLocal?: () => void | Promise<void>
  onReviewCurrentPage?: () => void | Promise<void>
  onReviewQueuedProblems?: () => void | Promise<void>
  selectedProblemId?: string
  isAnalyzingProblems?: boolean
  isLoadingProblems?: boolean
  problemAnalysisError?: string
  onSelectProblem?: (problem: PdfProblem) => void
  onProblemChange?: (problem: PdfProblem) => void
  onSessionChange?: (state: { baseDir: string; projectName: string; activeFileName: string }) => void
  onKeyboardCaptureChange?: (captured: boolean) => void
  isSnapped?: boolean
  snappedLayout?: { x: number; y: number; width: number; height: number }
  onPdfPageChange?: (direction: -1 | 1) => void
  pdfFileNavigation?: PracticePdfFileNavigation
  onOpenPdfPage?: (page: number) => void
  onOpenPdfTheoryPage?: (page: number, problem?: PdfProblem) => void
  onExitCodingMode?: () => void
}

export const CodeSandboxWindow = memo(function CodeSandboxWindow({
  isOpen,
  onClose,
  windowMode,
  baseDir,
  initialProjectName,
  initialFileName,
  initialActiveFileName,
  ocrInsertRequest,
  pdfPath = "",
  problemBaseDir,
  problems = [],
  problemReviewQueueRefreshKey = "",
  problemAutoReviewStatus = null,
  onReviewAllProblems,
  onReviewAllProblemsLocal,
  onReviewCurrentPage,
  onReviewQueuedProblems,
  selectedProblemId = "",
  isAnalyzingProblems = false,
  isLoadingProblems = false,
  problemAnalysisError = "",
  onSelectProblem,
  onProblemChange,
  onSessionChange,
  onKeyboardCaptureChange,
  isSnapped,
  snappedLayout,
  onPdfPageChange,
  pdfFileNavigation,
  onOpenPdfPage,
  onOpenPdfTheoryPage,
  onExitCodingMode,
}: CodeSandboxWindowProps) {
  const { resolvedTheme } = useTheme()
  const syntaxTheme = customSyntaxTheme(resolvedTheme)
  const onPdfPageChangeRef = useRef(onPdfPageChange)
  onPdfPageChangeRef.current = onPdfPageChange
  const onSessionChangeRef = useRef(onSessionChange)
  onSessionChangeRef.current = onSessionChange
  const projectLoadSeqRef = useRef(0)
  const projectInitializedRef = useRef(false)
  const loadedProjectScopeRef = useRef("")
  const loadedBaseDirRef = useRef(normalizeProjectPath(baseDir).toLocaleLowerCase())

  const [projectName, setProjectName] = useState(initialProjectName || "")
  const [practiceProblemId, setPracticeProblemId] = useState(selectedProblemId)
  const practiceWindow = (windowMode ?? (pdfPath ? "problems" : "code")) === "problems"
  const practiceRootRef = useRef<HTMLDivElement | null>(null)
  const [sidebarMode, setSidebarMode] = useState<"problems" | "code">(
    !IDE_ENABLED || practiceWindow && pdfPath
      && normalizeProjectPath(baseDir).toLocaleLowerCase()
        === normalizeProjectPath(problemBaseDir || baseDir).toLocaleLowerCase()
      ? "problems"
      : "code",
  )
  // 문제풀이 창일 때만 문제 탐색·채점 UI를 노출한다. 코드 에디터로 열렸으면
  // 문제 컨텍스트가 있어도 파일 탐색기 전용 사이드바를 유지한다.
  const {
    managedProjectList,
    projectList,
    projectsLoaded,
    refreshProjects,
    setProjectList,
    setProjectsLoaded,
  } = useCodeProjectIndex(baseDir)
  const [selectedProjectPath, setSelectedProjectPath] = useState("")
  const [projectFolderPath, setProjectFolderPath] = useState(() => parentProjectPath(initialProjectName || ""))
  const [draggingProjectPath, setDraggingProjectPath] = useState("")
  const [customLanguageProfiles, setCustomLanguageProfiles] = useState<LanguageProfile[]>([])
  const [profileAction, setProfileAction] = useState<"run" | "build" | "test">("run")

  useLayoutEffect(() => {
    projectInitializedRef.current = false
  }, [baseDir])

  const handleSwitchProject = async (
    targetProj: string,
    options: { loadFiles?: boolean; flushDrafts?: boolean } = {},
  ) => {
    if (!IDE_ENABLED) return
    const trimmedProject = normalizeProjectPath(targetProj)
    const loadSeq = ++projectLoadSeqRef.current
    cancelProjectRequests()
    if (options.flushDrafts !== false) flushPendingProjectDrafts()
    if (options.loadFiles !== false) loadedProjectScopeRef.current = ""
    setSelectedProjectPath("")

    if (!trimmedProject) {
      setProjectName("")
      setProjectFolderPath("")
      setFiles([])
      setActiveFileId("")
      loadedProjectScopeRef.current = ""
      setDebugOutput({ stdout: "", stderr: "", visible: false })
      setSaveStatus("idle")
      void refreshProjects()
      return
    }

    try {
      if (options.loadFiles === false) {
        setSaveStatus("idle")
        return
      }
      const res = await getCodeProjectFiles({ base_dir: baseDir, project_name: trimmedProject })
      if (loadSeq !== projectLoadSeqRef.current) return
      if (!res.success) throw new Error(res.error || "Project folder could not be opened")

      setProjectName(trimmedProject)
      setProjectFolderPath(trimmedProject)
      const editableProjectFiles = Array.isArray(res.files)
        ? res.files.filter((file: { name?: string }) => !isProblemMetadataFile(String(file?.name || "")))
        : []
      if (editableProjectFiles.length > 0) {
        let drafts: Record<string, string> = {}
        try {
          const draftJson = readCodeProjectDraft(localStorage, baseDir, trimmedProject)
          if (draftJson) drafts = JSON.parse(draftJson)
        } catch { /* corrupted draft cache falls back to saved code */ }

        const loadedFiles = editableProjectFiles.map((f, idx: number) => ({
          id: idx === 0 ? "first-tab" : `file-${idx}-${Date.now()}`,
          name: f.name,
          code: drafts[f.name] !== undefined ? drafts[f.name] : f.code,
          savedCode: f.code,
          language: detectLanguageFromExtension(f.name, customLanguageProfiles)
        }))
        const preferredFile = initialActiveFileName
          ? loadedFiles.find((file) => file.name === initialActiveFileName)
          : undefined
        setFiles(loadedFiles)
        setActiveFileId((preferredFile ?? loadedFiles[0]).id)
      } else {
        setFiles([])
        setActiveFileId("")
      }
      setDebugOutput({ stdout: "", stderr: "", visible: false })
      setSaveStatus("idle")
      loadedProjectScopeRef.current = codeProjectLoadScope(baseDir, trimmedProject)
      void refreshProjects()
    } catch (e) {
      loadedProjectScopeRef.current = ""
      setSaveStatus("error")
      setSaveMsg(consoleErrorMessage(e, t("프로젝트 로딩 실패")))
    }
  }
  const switchProjectFromEffect = useEventCallback(handleSwitchProject)

  useEffect(() => {
    const normalizedFolder = normalizeProjectPath(projectFolderPath)
    if (normalizedFolder.startsWith(".ails-problems/round-workspaces/")) return
    if (!projectsLoaded || !normalizedFolder) return
    if (!projectList.includes(normalizedFolder)) {
      void switchProjectFromEffect(parentProjectPath(normalizedFolder), { loadFiles: true })
    }
  }, [projectFolderPath, projectList, projectsLoaded, switchProjectFromEffect])

  const [files, setFiles] = useState<SandboxFile[]>([])
  const [activeFileId, setActiveFileId] = useState("")
  const activeFile = files.find((file) => file.id === activeFileId)
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle")
  const [saveMsg, setSaveMsg] = useState("")
  const { flushPendingProjectDrafts, persistProjectDrafts } = useCodeProjectDrafts(baseDir, projectName)
  const {
    saveProject, isSaving, setIsSaving, cancelProjectRequests,
    addFile,
    commitRename,
    deleteFile,
    isAddingFile,
    newFileName,
    renameDraft,
    renamingFileId,
    setIsAddingFile,
    setNewFileName,
    setRenameDraft,
    setRenamingFileId,
    startRename,
  } = useCodeProjectFiles({
    activeFileId,
    baseDir,
    customLanguageProfiles,
    files,
    isOpen,
    persistProjectDrafts,
    projectName,
    refreshProjects,
    setActiveFileId,
    setFiles,
    setSaveMsg,
    setSaveStatus,
  })
  const [compilerDiagnostics, setCompilerDiagnostics] = useState<CompilerDiagnostic[]>([])
  const [bottomPanelTab, setBottomPanelTab] = useState<"console" | "ai_review">("console")
  const [firstRunNoticeAcknowledged, setFirstRunNoticeAcknowledged] = useState(() => {
    try {
      return localStorage.getItem("ails_code_sandbox_first_run_acknowledged") === "true"
    } catch {
      return false
    }
  })
  const consoleOutputRef = useRef<HTMLDivElement | null>(null)
  const lastProblemRunRef = useRef<CodeRunSnapshot | null>(null)
  const {
    runActiveFile, cancelRun, stopRun, resetRun, isDebugging, runSessionId, lastRunElapsed, setLastRunElapsed,
    consoleAutoInput,
    consoleInput,
    consoleInputClosed,
    consoleInputRef,
    consoleReturnCode,
    consoleStatus,
    consoleTruncated,
    debugOutput,
    isConsoleInputRetained,
    isConsoleInputSettingsOpen,
    isSendingConsoleInput,
    setConsoleInput,
    setConsoleReturnCode,
    setConsoleStatus,
    setDebugOutput,
    setIsConsoleInputSettingsOpen,
    submitConsoleInput,
    updateConsoleAutoInput,
    updateConsoleInputRetained,
  } = useCodeExecutionConsole({
    activeFile,
    files,
    profileAction,
    lastProblemRunRef,
    setBottomPanelTab,
    setCompilerDiagnostics,
    baseDir,
    projectName,
  })
  const lastOcrInsertIdRef = useRef(0)
  const lastShiftDownAtRef = useRef(0)

  const [isSettingTemplate, setIsSettingTemplate] = useState(false)
  const [settingsTab, setSettingsTab] = useState<"editor" | "templates"
    /* @ails-feature:developer_tools:start */
    | "toolchains"
    /* @ails-feature:developer_tools:end */
    | "languages">("editor")
  const [settingLanguage, setSettingLanguage] = useState("python")
  const [customTemplateText, setCustomTemplateText] = useState("")
  const [templateSaveOk, setTemplateSaveOk] = useState(false)
  const keyboardActionsRef = useRef<{
    dispatch: (action: CodeShortcutAction) => void
    review: () => Promise<void>
  } | null>(null)
  // Native key listeners keep stable callbacks while feature hooks replace their
  // functions. Publish the committed render before a key can invoke an action.
  const runShortcutActionEvent = useCallback((action: CodeShortcutAction) =>
    keyboardActionsRef.current?.dispatch(action), [])
  const requestAiReviewEvent = useCallback(() => keyboardActionsRef.current?.review(), [])
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    fileId: string
    projectName: string
    type: "file" | "project" | "project-space"
  }>({ visible: false, x: 0, y: 0, fileId: "", projectName: "", type: "file" })
  const [isShowHelp, setIsShowHelp] = useState(false)

  const {
    aiReviewHeight,
    consoleHeight,
    handleConsoleBorderMouseDown,
    handleConsoleBorderMouseMove,
    handleDragDown,
    handleSidebarResizeDown,
    handleWindowBorderMouseDown,
    handleWindowBorderMouseMove,
    handleWindowClickCapture,
    isConsoleResizeHovered,
    isConsoleResizing,
    isResizing,
    position,
    resizeHoverDirection,
    setResizeHoverDirection,
    setIsConsoleResizeHovered,
    sidebarWidth,
    size,
    suppressNextBorderClickTimerRef,
  } = useCodeSandboxWindowChrome({
    debugOutputVisible: debugOutput.visible,
    isSnapped,
    snappedLayout,
  })

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const activeLanguageProfile = customLanguageProfiles.find((profile) => profile.id === activeFile?.language)
  const dirtyFiles = files.filter((file) => file.code !== file.savedCode)
  const {
    activeProblem,
    activeProblemAnswerInputType,
    activeProblemAnswerType,
    activeProblemBinaryPrompt,
    activeProblemDataScope,
    activeProblemDataScopeRef,
    activeProblemDisplayBlocks,
    activeProblemScope,
    activeProblemScopeRef,
    codeWorkspaceVisible,
    hasConsistentProblemContext,
    isManagedProblemProjectPath,
    navigatorChapters,
    problemFolderRevision,
    problemStorageBaseDir,
    practiceProblems,
    retrySession,
    visiblePracticeProblems,
  } = useCodePracticeProblems({
    baseDir,
    managedProjectList,
    pdfPath,
    problemBaseDir,
    problems,
    practiceProblemId,
    projectName,
    selectedProblemMode: sidebarMode === "problems",
  })
  const activeFileRef = useRef(activeFile)
  const {
    isProblemActionPending,
    retryActiveProblem,
    retryProblems,
    problemActionLockRef,
    setSelectedPracticeProblemIds,
    setProblemClockNow,
    isProblemTypeMenuOpen,
    problemTypeMenuRef,
    setIsProblemTypeMenuOpen,
    recordActiveProblemHint,
    flushActiveProblemAnswerSave,
    openProblemEditor,
    pendingReviewQueueCount,
    isProblemAnswerSaving,
    problemReviewQueue,
    setIsProblemReviewQueueOpen,
    isProblemTypeUpdating,
    changeActiveProblemAnswerType,
    toggleActiveProblemTimer,
    isProblemTimerUpdating,
    problemClockNow,
    isProblemHintVisible,
    isProblemHintLoading,
    activeProblemHint,
    toggleActiveProblemHint,
    previousPracticeProblem,
    selectPracticeProblem,
    openActiveProblemAnswerEditor,
    gradeActiveProblem,
    isProblemGrading,
    nextPracticeProblem,
    problemHintError,
    setIsProblemHintVisible,
    problemActionError,
    displayedProblemGrade,
    latestMistakeNote,
    openPracticeTheoryPage,
    displayedTheory,
    activeChapterProblems,
    batchDialogAnsweredCount,
    batchDialogChangedCount,
    batchDialogProblems,
    batchProblemHasAnswer,
    expandedPracticeChapters,
    isPracticeSelectionMode,
    openProblemBatchDialog,
    problemBatchDialogIds,
    selectedPracticeProblemIds,
    setExpandedPracticeChapters,
    setIsPracticeSelectionMode,
    setProblemBatchDialogIds,
    startProblemBatchGrading,
    togglePracticeProblemSelection,
    problemAnswerIsDirty,
    problemAnswerEditorRef,
    activeProblemBinarySelections,
    problemAnswerText,
    selectActiveProblemBinaryAnswer,
    setProblemSelectedChoice,
    setProblemGradeResult,
    setProblemActionError,
    problemSelectedChoice,
    setProblemAnswerText,
    currentProblemFeedbackGrade,
    previousProblemFeedbackGrade,
    isProblemReviewQueueOpen,
    isReviewQueueSaving,
    reviewQueueEditor,
    saveReviewQueueResolution,
    selectReviewQueueCandidate,
    setReviewQueueEditor,
    problemEditDialog,
    isProblemEditing,
    saveProblemEdits,
    setProblemEditDialog,
  } = useCodePracticeActions({
    onRetrySessionStart: retrySession.begin,
    pdfPath,
    problemStorageBaseDir,
    problemReviewQueueRefreshKey,
    activeProblem,
    activeProblemAnswerInputType,
    activeProblemScope,
    practiceProblems,
    navigatorChapters,
    activeFileRef,
    activeFile,
    activeProblemDataScope,
    practiceWindow,
    setSidebarMode,
    activeProblemDataScopeRef,
    onProblemChange,
    activeProblemScopeRef,
    setPracticeProblemId,
    onSelectProblem,
    onOpenPdfPage,
    onOpenPdfTheoryPage,
    activeProblemAnswerType,
    activeProblemBinaryPrompt,
    files,
    lastProblemRunRef,
    hasConsistentProblemContext,
    projectName,
    loadedProjectScopeRef,
  })
  const { requestAiReview, aiReview, aiReviewScopeRef, setAiReviewForScope, aiReviewVisible, isAiReviewing, setAiReviewVisibleForScope, aiReviewScope, aiReviewEvaluatedSignature, aiReviewPhase, aiReviewError } = useCodeAiReview({
    baseDir,
    projectName,
    codeWorkspaceVisible,
    activeFile,
    recordActiveProblemHint,
    setBottomPanelTab,
    files,
    lastProblemRunRef,
    setLastRunElapsed,
    setDebugOutput,
  })
  const { setIsCreatingProject, setNewProjectName, isCreatingProject, handleMoveProject, setRenamingProjectPath, setProjectRenameDraft, handleDeleteProject, handleCreateProjectSubmit, newProjectName, renamingProjectPath, handleRenameProject, projectRenameDraft } = useCodeProjectMutations({
    projectFolderPath,
    setSaveStatus,
    setSaveMsg,
    projectList,
    baseDir,
    setProjectsLoaded,
    setProjectList,
    handleSwitchProject,
    isManagedProblemProjectPath,
    selectedProjectPath,
    setSelectedProjectPath,
    projectName,
    refreshProjects,
    setProjectName,
    setProjectFolderPath,
    setDraggingProjectPath,
  })

  useEffect(() => {
    const handleOpenCreateProject = () => {
      setIsCreatingProject(true)
      setNewProjectName("")
    }
    window.addEventListener("ails-create-project", handleOpenCreateProject)
    return () => {
      window.removeEventListener("ails-create-project", handleOpenCreateProject)
    }
  }, [setIsCreatingProject, setNewProjectName])

  useLayoutEffect(() => {
    keyboardActionsRef.current = { dispatch: runShortcutAction, review: requestAiReview }
  })

  const resetRunFromEffect = useEffectEvent(resetRun)
  const problemFolderRevisionRef = useRef("")

  useEffect(() => {
    const normalizedBaseDir = normalizeProjectPath(baseDir).toLocaleLowerCase()
    if (loadedBaseDirRef.current === normalizedBaseDir) return
    loadedBaseDirRef.current = normalizedBaseDir
    projectLoadSeqRef.current += 1
    loadedProjectScopeRef.current = ""
    flushPendingProjectDrafts()
    resetRunFromEffect()
    lastProblemRunRef.current = null
    setFiles([])
    setActiveFileId("")
    setCompilerDiagnostics([])
    setDebugOutput({ stdout: "", stderr: "", visible: false })
    setConsoleStatus("idle")
    setConsoleReturnCode(null)
    setSaveStatus("idle")
    setSaveMsg("")
  }, [baseDir, flushPendingProjectDrafts, setConsoleReturnCode, setConsoleStatus, setDebugOutput])

  useEffect(() => {
    if (isProblemActionPending || problemActionLockRef.current) return
    setPracticeProblemId(selectedProblemId)
    if (selectedProblemId) setSidebarMode("problems")
  }, [isProblemActionPending, problemActionLockRef, selectedProblemId])

  useEffect(() => {
    const available = new Set(practiceProblems.map((problem) => problem.id))
    setSelectedPracticeProblemIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
  }, [practiceProblems, setSelectedPracticeProblemIds])

  const activeProblemProject = activeProblem?.folder_path && activeProblemAnswerType === "code"
    ? projectPathForPdfProblem(activeProblem, problemStorageBaseDir)
    : ""
  useEffect(() => {
    if (!activeProblemProject) return
    if (normalizeProjectPath(baseDir).toLocaleLowerCase() !== normalizeProjectPath(problemStorageBaseDir).toLocaleLowerCase()) return
    const targetScope = codeProjectLoadScope(baseDir, activeProblemProject)
    if (
      normalizeProjectPath(projectName) === normalizeProjectPath(activeProblemProject)
      && loadedProjectScopeRef.current === targetScope
    ) return
    void switchProjectFromEffect(activeProblemProject, {
      loadFiles: true,
      flushDrafts: loadedProjectScopeRef.current.startsWith(`${normalizeProjectPath(baseDir).toLocaleLowerCase()}\u0000`),
    })
  }, [
    activeProblemProject,
    baseDir,
    problemStorageBaseDir,
    projectName,
    switchProjectFromEffect,
  ])

  useEffect(() => {
    if (!problemFolderRevision || problemFolderRevisionRef.current === problemFolderRevision) return
    problemFolderRevisionRef.current = problemFolderRevision
    if (isOpen) void refreshProjects()
  }, [isOpen, problemFolderRevision, refreshProjects])

  useEffect(() => {
    setProblemClockNow(Date.now())
    if (!activeProblem?.timer_started_at) return
    const timer = window.setInterval(() => setProblemClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [activeProblem?.id, activeProblem?.timer_started_at, setProblemClockNow])

  useEffect(() => {
    if (!isProblemTypeMenuOpen) return
    const closeTypeMenu = (event: PointerEvent) => {
      if (!problemTypeMenuRef.current?.contains(event.target as Node)) {
        setIsProblemTypeMenuOpen(false)
      }
    }
    document.addEventListener("pointerdown", closeTypeMenu)
    return () => document.removeEventListener("pointerdown", closeTypeMenu)
  }, [isProblemTypeMenuOpen, problemTypeMenuRef, setIsProblemTypeMenuOpen])

  useEffect(() => {
    const actions = activeLanguageProfile?.actions || Object.keys(activeLanguageProfile?.commands || {})
    if (!actions.includes(profileAction)) setProfileAction("run")
  }, [activeLanguageProfile, profileAction])

  const applyCustomLanguageProfiles = useCallback((profiles: LanguageProfile[]) => {
    setCustomLanguageProfiles(profiles)
    setFiles((current) => current.map((file) => ({
      ...file,
      language: detectLanguageFromExtension(file.name, profiles),
    })))
    const monaco = monacoRef.current
    if (monaco) {
      void syncCustomLanguageSyntax(monaco, profiles).then(() => {
        const model = editorRef.current?.getModel?.()
        const currentFile = activeFileRef.current
        if (model && currentFile) monaco.editor.setModelLanguage(model, monacoLanguageForFile(currentFile))
        monaco.editor.setTheme(syntaxTheme)
      })
    }
  }, [syntaxTheme])

  useEffect(() => {
    if (!isOpen || !DEVELOPER_TOOLS_ENABLED) return
    let cancelled = false
    void getLanguageProfiles().then((result) => {
      if (!cancelled) applyCustomLanguageProfiles(result.profiles)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [applyCustomLanguageProfiles, isOpen])
  const {
    editorFontSizeRef,
    consoleEncoding,
    changeConsoleEncoding,
    codeShortcuts,
    schedulePersistEditorFontSize,
    adjustEditorFontSizeFromWheel,
    keymapProfile,
    sidebarPanelRef,
    handleSidebarWheel,
    sidebarListFontSize,
    handleSettingsContentWheel,
    settingsContentRef,
    settingsContentFontSize,
    changeKeymapProfile,
    resetAllCodeShortcuts,
    shortcutMessage,
    recordingShortcutAction,
    shortcutOverridesByProfile,
    setShortcutMessage,
    setRecordingShortcutAction,
    changeCodeShortcut,
    resetCodeShortcut,
    editorFontSize,
    updateEditorFontSize,
    adjustSidebarListFontSize,
    aiReviewFontSize,
    adjustAiReviewFontSize,
    adjustSettingsContentFontSize,
    aiReviewPanelRef,
    handleAiReviewWheel,
  } = useCodeEditorPreferences({
    editorRef,
    onKeyboardCaptureChange,
    monacoRef,
    activeFileId,
    isOpen,
    isSettingTemplate,
    aiReviewVisible,
  })

  const { editorDisposablesRef, revealLine, revealIssue, scheduleEditorLayout, scheduleAiIssueLineSync, applyAiDecorations, applyCompilerMarkers } = useCodeEditorAnnotations({
    aiReview,
    editorRef,
    monacoRef,
    activeFile,
    compilerDiagnostics,
    files,
    setActiveFileId,
    activeFileRef,
    aiReviewScopeRef,
    setAiReviewForScope,
    activeFileId,
    syntaxTheme,
    customLanguageProfiles,
    aiReviewHeight,
    aiReviewVisible,
    consoleHeight,
    debugOutput,
    size,
  })

  useEffect(() => {
    if (!isOpen) return
    onSessionChangeRef.current?.({
      baseDir,
      projectName,
      activeFileName: activeFile?.name || "",
    })
  }, [activeFile?.name, baseDir, isOpen, projectName])

  const initializeProjectFromList = useEventCallback(() => {
    if (!baseDir || !projectsLoaded) return
    if (projectInitializedRef.current) return
    projectInitializedRef.current = true
    if (projectList.length === 0) {
      setProjectName("")
      setProjectFolderPath("")
      setSelectedProjectPath("")
      setFiles([])
      setActiveFileId("")
      return
    }

    const requestedProject = (projectName || initialProjectName || selectedProjectPath || "").trim()
    const targetProject = projectList.includes(requestedProject) ? requestedProject : projectList[0]
    if (!targetProject) return

    if (
      projectName === targetProject
      && projectFolderPath === targetProject
      && loadedProjectScopeRef.current === codeProjectLoadScope(baseDir, targetProject)
    ) {
      const preferredFile = initialActiveFileName || initialFileName
      if (preferredFile && files.length > 0) {
        const found = files.find((f) => f.name === preferredFile)
        if (found && found.id !== activeFileId) {
          setActiveFileId(found.id)
        }
      }
      return
    }

    void handleSwitchProject(targetProject, { loadFiles: true })
  })
  useEffect(() => {
    initializeProjectFromList()
  }, [baseDir, initialFileName, initialProjectName, isOpen, initialActiveFileName, projectList, projectsLoaded, initializeProjectFromList])

  useEffect(() => {
    const custom = readPersistedTemplate(settingLanguage)
    setCustomTemplateText(custom ?? fallbackTemplate(settingLanguage))
    setTemplateSaveOk(false)
  }, [settingLanguage, isSettingTemplate])

  const releaseKeyboardCapture = useEffectEvent(() => onKeyboardCaptureChange?.(false))
  useEffect(() => {
    return () => {
      releaseKeyboardCapture()
      if (suppressNextBorderClickTimerRef.current !== null) {
        window.clearTimeout(suppressNextBorderClickTimerRef.current)
        suppressNextBorderClickTimerRef.current = null
      }
      flushPendingProjectDrafts()
    }
  }, [flushPendingProjectDrafts, suppressNextBorderClickTimerRef])

  useEffect(() => {
    if (!debugOutput.visible) return
    const output = consoleOutputRef.current
    if (output) output.scrollTop = output.scrollHeight
  }, [debugOutput.stderr, debugOutput.stdout, debugOutput.visible])

  useEffect(() => {
    const handleCloseMenu = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }))
      }
      if (isShowHelp) {
        setIsShowHelp(false)
      }
    }
    window.addEventListener("click", handleCloseMenu)
    return () => {
      window.removeEventListener("click", handleCloseMenu)
    }
  }, [contextMenu.visible, isShowHelp])

  useEffect(() => {
    if (!codeWorkspaceVisible) lastShiftDownAtRef.current = 0
  }, [codeWorkspaceVisible])

  function switchProjectByOffset(offset: number) {
    if (projectList.length === 0) return
    const currentIndex = projectList.findIndex((project) => project === selectedProjectPath || project === projectName)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (baseIndex + offset + projectList.length) % projectList.length
    const nextProject = projectList[nextIndex]
    if (nextProject && nextProject !== projectName) {
      void handleSwitchProject(nextProject, { loadFiles: true })
    }
  }

  function switchFileByOffset(offset: number) {
    if (files.length <= 1) return
    const currentIndex = files.findIndex((file) => file.id === activeFileId)
    if (currentIndex < 0) return
    const nextIndex = (currentIndex + offset + files.length) % files.length
    setActiveFileId(files[nextIndex].id)
  }

  function runShortcutAction(action: CodeShortcutAction) {
    switch (action) {
      case "run":
        if (isDebugging) cancelRun()
        else void runActiveFile()
        break
      case "save":
        void saveProject(false)
        break
      case "saveAll":
        void saveProject(true)
        break
      case "newFile":
        if (projectName) setIsAddingFile(true)
        break
      case "newProject":
        setIsCreatingProject(true)
        setNewProjectName("")
        break
      case "closeFile":
        setActiveFileId("")
        break
      case "renameFile":
        if (activeFile) startRename(activeFile)
        break
      case "nextTab":
        switchFileByOffset(1)
        break
      case "previousTab":
        switchFileByOffset(-1)
        break
      case "nextProject":
        switchProjectByOffset(1)
        break
      case "previousProject":
        switchProjectByOffset(-1)
        break
      case "nextPdfPage":
        onPdfPageChangeRef.current?.(1)
        break
      case "previousPdfPage":
        onPdfPageChangeRef.current?.(-1)
        break
      case "promptEdit":
        void handlePromptCodeEdit()
        break
      case "toggleChatbot":
        window.dispatchEvent(new CustomEvent("ails-toggle-chatbot"))
        break
    }
  }

  const practicePdfFiles = usePracticePdfFiles({
    enabled: isOpen && practiceWindow,
    pdfPath,
    blocked: isProblemActionPending || isSettingTemplate || isCreatingProject || isAddingFile
      || Boolean(problemEditDialog) || isProblemReviewQueueOpen || Boolean(reviewQueueEditor)
      || Boolean(problemBatchDialogIds) || Boolean(renamingFileId) || contextMenu.visible,
    navigation: pdfFileNavigation,
    beforeOpen: async () => {
      if (problemActionLockRef.current) return false
      flushPendingProjectDrafts()
      const saved = await flushActiveProblemAnswerSave()
      if (problemAnswerIsDirty && !saved) return false
      setIsShowHelp(false)
      return true
    },
    onError: (error) => setProblemActionError(consoleErrorMessage(error, t("PDF 파일을 열지 못했습니다."))),
  })

  const practiceActionPending = isProblemActionPending || practicePdfFiles.busy
  usePracticeNavigation({
    enabled: isOpen && practiceWindow,
    activeKey: activeProblem ? activeProblemScope : null,
    blocked: practiceActionPending || isSettingTemplate || isShowHelp || isCreatingProject
      || isAddingFile || Boolean(renamingFileId) || contextMenu.visible || Boolean(problemEditDialog)
      || isProblemReviewQueueOpen || Boolean(reviewQueueEditor) || Boolean(problemBatchDialogIds),
    isCode: activeProblemAnswerType === "code",
    rootRef: practiceRootRef,
    answerRef: problemAnswerEditorRef,
    codeInputRef: editorRef,
    onPrevious: previousPracticeProblem ? () => selectPracticeProblem(previousPracticeProblem) : undefined,
    onNext: nextPracticeProblem ? () => selectPracticeProblem(nextPracticeProblem) : undefined,
  })

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if (!isOpen) return
      const targetRoot = event.target instanceof Element ? event.target.closest("[data-ails-code-sandbox='true']") : null
      if (targetRoot && targetRoot !== practiceRootRef.current) return
      if (practiceWindow && targetRoot !== practiceRootRef.current) return
      if (event.target instanceof Element && event.target.closest("[data-practice-grading-context-dialog]")) return
      // Practice navigation takes priority over configurable IDE/project shortcuts.
      if (practiceWindow && targetRoot === practiceRootRef.current
        && practiceNavigationDirection(event, activeProblemAnswerType === "code")) return
      if (event.target instanceof Element && event.target.closest("[data-practice-actions-popup], [data-answer-key-dialog], [data-problem-edit-dialog], [data-practice-grading-context-dialog]")) return

      const aiShortcutBlocked =
        !codeWorkspaceVisible ||
        isSettingTemplate ||
        isShowHelp ||
        isCreatingProject ||
        isAddingFile ||
        Boolean(renamingFileId) ||
        contextMenu.visible ||
        // 함수 키는 텍스트 입력에 쓰이지 않으므로 입력창 포커스에서도 단축키로 취급한다.
        (isTextEntryElement(event.target) && !isMonacoEditorElement(event.target) && !/^F\d{1,2}$/.test(event.key))

      if (isSnapped && event.key === "Shift" && !event.repeat && !aiShortcutBlocked) {
        const now = performance.now()
        if (now - lastShiftDownAtRef.current <= 350) {
          lastShiftDownAtRef.current = 0
          event.preventDefault()
          event.stopPropagation()
          void requestAiReviewEvent()
          return
        }
        lastShiftDownAtRef.current = now
      }

      if (!aiShortcutBlocked) {
        const matchedShortcut = CODE_SHORTCUT_DEFINITIONS.find((definition) =>
          shortcutMatchesEvent(codeShortcuts[definition.action], event),
        )
        if (matchedShortcut) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          runShortcutActionEvent(matchedShortcut.action)
          return
        }
        // F5는 키맵 프로필과 관계없이 코드 실행으로 동작한다(다른 동작에 바인딩된 경우 제외).
        if (event.code === "F5") {
          const f5BoundElsewhere = CODE_SHORTCUT_DEFINITIONS.some(
            (definition) => definition.action !== "run" && shortcutMatchesEvent(codeShortcuts[definition.action], event),
          )
          if (!f5BoundElsewhere) {
            event.preventDefault()
            event.stopPropagation()
            event.stopImmediatePropagation()
            runShortcutActionEvent("run")
            return
          }
        }
      }

      if (
        event.key === "Escape"
        && event.target instanceof HTMLElement
        && event.target.closest("[data-console-auto-input-settings='true']")
      ) {
        event.preventDefault()
        event.stopPropagation()
        setIsConsoleInputSettingsOpen(false)
        return
      }

      if (event.key === "Escape" && debugOutput.visible) {
        event.preventDefault()
        event.stopPropagation()
        setDebugOutput((prev) => ({ ...prev, visible: false }))
        return
      }

      if (event.key === "Escape" && isSnapped && onExitCodingMode) {
        event.preventDefault()
        event.stopPropagation()
        onExitCodingMode()
        return
      }

      const target = event.target as HTMLElement
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        if (!target.classList.contains("inputarea")) {
          return
        }
      }

      if (codeWorkspaceVisible && event.key === "Enter" && editorRef.current) {
        if (!editorRef.current.hasWidgetFocus()) {
          event.preventDefault()
          event.stopPropagation()
          editorRef.current.focus()
          editorRef.current.setPosition({ lineNumber: 1, column: 1 })
          return
        }
      }

    }

    window.addEventListener("keydown", handleGlobalKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown, true)
    }
  }, [
    isOpen,
    codeShortcuts,
    activeFile,
    debugOutput.visible,
    files,
    activeFileId,
    projectList,
    projectName,
    selectedProjectPath,
    isSnapped,
    isDebugging,
    isAiReviewing,
    isSettingTemplate,
    isShowHelp,
    isCreatingProject,
    isAddingFile,
    renamingFileId,
    contextMenu.visible,
    codeWorkspaceVisible,
    practiceWindow,
    activeProblemAnswerType,
    onExitCodingMode,
    setDebugOutput,
    setIsConsoleInputSettingsOpen,
    runShortcutActionEvent,
    requestAiReviewEvent,
  ])
  const {
    handleEditorWillMount,
    handleEditorDidMount,
  } = createCodeEditorMountHandlers({
    editorDisposablesRef,
    editorRef,
    monacoRef,
    customLanguageProfiles,
    activeFileRef,
    syntaxTheme,
    activeFile,
    editorFontSizeRef,
    scheduleEditorLayout,
    onKeyboardCaptureChange,
    scheduleAiIssueLineSync,
    schedulePersistEditorFontSize,
    adjustEditorFontSizeFromWheel,
    keymapProfile,
    applyAiDecorations,
    applyCompilerMarkers,
  })

  function updateActiveFileCode(value: string | undefined) {
    if (value === undefined) return
    setFiles((current) => {
      const currentFile = current.find((file) => file.id === activeFileId)
      if (currentFile?.code === value) return current
      const nextFiles = current.map((file) => (file.id === activeFileId ? { ...file, code: value } : file))
      persistProjectDrafts(nextFiles)
      return nextFiles
    })
  }

  function insertOcrTextAtCursor(code: string) {
    const snippet = trimExtractedCodeBlock(code)
    if (!snippet.trim()) return false
    if (!activeFileId || !activeFile) return false
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel?.()
    if (!editor || !monaco || !model) return false

    const position = editor.getPosition?.() ?? { lineNumber: 1, column: 1 }
    const selection = editor.getSelection?.()
    const range = selection ?? new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
    const startLineNumber = range.startLineNumber
    const startColumn = range.startColumn
    const insertedLines = snippet.split("\n")
    const endLineNumber = startLineNumber + insertedLines.length - 1
    const endColumn = insertedLines.length === 1
      ? startColumn + insertedLines[0].length
      : insertedLines[insertedLines.length - 1].length + 1
    const cursorSelection = new monaco.Selection(endLineNumber, endColumn, endLineNumber, endColumn)

    editor.pushUndoStop?.()
    editor.executeEdits(
      "pdf-region-ocr",
      [{ range, text: snippet, forceMoveMarkers: true }],
      [cursorSelection],
    )
    editor.pushUndoStop?.()
    updateActiveFileCode(model.getValue())
    editor.revealPositionInCenter?.({ lineNumber: endLineNumber, column: endColumn })
    editor.focus()
    return true
  }
  const insertOcrTextFromEffect = useEffectEvent((code: string) => insertOcrTextAtCursor(code))

  useEffect(() => {
    if (!ocrInsertRequest || ocrInsertRequest.id <= lastOcrInsertIdRef.current) return
    lastOcrInsertIdRef.current = ocrInsertRequest.id
    const inserted = insertOcrTextFromEffect(ocrInsertRequest.text)
    if (inserted) {
      setSaveStatus("success")
      setSaveMsg(`Page ${ocrInsertRequest.page} OCR text inserted at cursor`)
    } else {
      setSaveStatus("error")
      setSaveMsg("No OCR text detected")
    }
    const timer = window.setTimeout(() => setSaveStatus("idle"), 3000)
    return () => window.clearTimeout(timer)
  }, [activeFileId, ocrInsertRequest])

  const handlePromptCodeEdit = async () => {
    if (!codeWorkspaceVisible || !activeFile) return
    const instruction = prompt(t("AI에게 요청할 코드 수정 명령을 입력하세요:\n(예: 이 함수를 테스트할 main 함수를 만들어줘)"))
    if (!instruction || !instruction.trim()) return
    recordActiveProblemHint()

    const controller = new AbortController()
    setIsSaving(true)
    setSaveStatus("idle")
    setSaveMsg(t("AI가 코드를 수정하고 있습니다..."))

    try {
      const filesPayload = files.map((file) => ({ name: file.name, code: file.code }))
      const result = await promptEditCodeSandbox(
        {
          file_name: activeFile.name,
          language: activeFile.language,
          code: activeFile.code,
          instruction: instruction.trim(),
          files: filesPayload,
        },
        controller.signal
      )

      if (result && result.code) {
        setFiles((prev) =>
          prev.map((f) => (f.id === activeFileId ? { ...f, code: result.code } : f))
        )
        setSaveStatus("success")
        setSaveMsg(t("AI 수정 완료"))
      } else {
        setSaveStatus("error")
        setSaveMsg(t("AI가 코드를 생성하지 못했습니다."))
      }
    } catch (error) {
      if (controller.signal.aborted) return
      setSaveStatus("error")
      setSaveMsg(t("AI 수정 실패: {p0}", { p0: consoleErrorMessage(error, "오류 발생") }))
    } finally {
      setIsSaving(false)
    }
  }

  const handleCloseWindow = usePracticeClose({
    blocked: isProblemActionPending || isSaving, practiceWindow, answerDirty: problemAnswerIsDirty,
    dirtyFiles, problems: practiceProblems, projectName, baseDir: problemStorageBaseDir, pdfPath,
    scope: activeProblemScope, scopeRef: activeProblemScopeRef,
    flushAnswer: flushActiveProblemAnswerSave, flushCodeDrafts: flushPendingProjectDrafts,
    cancelProjectRequests, stopRun, setFiles, onError: setProblemActionError,
    onKeyboardCaptureChange, onClose,
  })

  function saveCustomTemplate() {
    writePersistedTemplate(settingLanguage, customTemplateText)
    setTemplateSaveOk(true)
    window.setTimeout(() => setTemplateSaveOk(false), 3000)
  }

  function displayBasePath() {
    if (!baseDir) return "loading..."
    const normalized = baseDir.replace(/\\/g, "/")
    const lastPart = normalized.split("/").pop() || normalized
    return `${lastPart}/`
  }

  const folders = useMemo(() => {
    const map = new Map<string, SandboxFile[]>()
    files.forEach((file) => {
      const folder = parentFolder(file.name) || "."
      map.set(folder, [...(map.get(folder) ?? []), file])
    })
    return [...map.entries()]
  }, [files])

  const normalizedProjectFolderPath = normalizeProjectPath(projectFolderPath)
  const parentProjectFolderPath = parentProjectPath(normalizedProjectFolderPath)
  const projectBrowserEntries = useMemo(
    () => buildProjectBrowserEntries(projectList, normalizedProjectFolderPath),
    [projectList, normalizedProjectFolderPath],
  )

  const navigationFold = usePracticeNavigationFold()
  const practiceTutor = usePdfPracticeTutor(activeProblem, pdfPath, problemAnswerText, problemSelectedChoice, currentProblemFeedbackGrade,
    files, sidebarWidth, isOpen && practiceWindow, navigationFold.manualCollapsed ? 48 : sidebarWidth)

  return (
    <div
      ref={practiceRootRef}
      data-ails-code-sandbox="true"
      role="dialog"
      aria-label={practiceWindow ? t("문제풀이") : t("코드 에디터")}
      data-ails-practice-mode={practiceWindow && sidebarMode === "problems" ? "true" : undefined}
      aria-hidden={!isOpen}
      inert={!isOpen}
      tabIndex={-1}
      style={{
        left: isSnapped ? snappedLayout?.x ?? 0 : position.x,
        top: isSnapped ? snappedLayout?.y ?? 0 : position.y,
        width: isSnapped ? Math.max(420, snappedLayout?.width ?? Math.floor(window.innerWidth / 2)) : size.width,
        height: isSnapped ? (practiceWindow && practiceTutor?.open ? snappedLayout?.height ?? window.innerHeight : Math.max(420, snappedLayout?.height ?? window.innerHeight)) : size.height,
        cursor: codeSandboxResizeCursor(resizeHoverDirection),
      }}
      className={`ails-code-layout-border ${practiceWindow ? "ails-practice-window shadow-none" : "shadow-xl"} fixed z-[85] isolate flex flex-col overflow-hidden border bg-[var(--practice-shell)] text-[var(--foreground)] transition-[background-color] duration-300 ${!isOpen ? "invisible pointer-events-none" : ""} ${resizeHoverDirection ? "ails-code-window-border-resize" : ""} ${isSnapped ? "rounded-l-2xl rounded-r-none" : "rounded-2xl"}`}
      onClickCapture={handleWindowClickCapture}
      onFocus={() => onKeyboardCaptureChange?.(true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        onKeyboardCaptureChange?.(false)
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) event.currentTarget.focus()
      }}
      onMouseDownCapture={handleWindowBorderMouseDown}
      onMouseLeave={() => {
        if (!isResizing) setResizeHoverDirection("")
      }}
      onMouseMoveCapture={handleWindowBorderMouseMove}
    >
      <style>{`
        .ails-ai-review-line-error { background: rgba(248, 113, 113, 0.18); }
        .ails-ai-review-line-warning { background: rgba(251, 191, 36, 0.16); }
        .ails-ai-review-line-info { background: rgba(56, 189, 248, 0.14); }
        .ails-code-layout-border { border-color: var(--practice-border) !important; }
        .ails-code-layout-border-subtle { border-color: var(--practice-border) !important; }
        .ails-code-window-border-resize,
        .ails-code-window-border-resize * { cursor: inherit !important; }
        .ails-code-console-border-resize,
        .ails-code-console-border-resize * { cursor: inherit !important; }
        .ails-code-sidebar-panel {
          font-size: var(--ails-code-sidebar-list-font-size);
          line-height: 1.45;
        }
        .ails-code-sidebar-section,
        .ails-code-sidebar-list-text,
        .ails-code-sidebar-panel :where(input, button) {
          font-size: var(--ails-code-sidebar-list-font-size);
          line-height: 1.45;
        }
        .ails-code-sidebar-meta {
          font-size: max(8px, calc(var(--ails-code-sidebar-list-font-size) - 1px)) !important;
          line-height: 1.35;
        }
        .ails-code-project-list {
          contain: layout paint style;
          isolation: isolate;
        }
        .ails-code-project-entry {
          transition: none !important;
        }
        .ails-code-ai-review-panel {
          font-size: var(--ails-code-ai-review-font-size);
          line-height: 1.45;
        }
        .ails-code-ai-review-panel :where(.ails-code-ai-review-text) {
          font-size: var(--ails-code-ai-review-font-size) !important;
          line-height: 1.45;
        }
        .ails-code-ai-review-panel :where(.ails-code-ai-review-meta) {
          font-size: max(9px, calc(var(--ails-code-ai-review-font-size) - 1px)) !important;
          line-height: 1.35;
        }
        .ails-ai-review-card:not(:disabled) {
          background-color: rgba(9, 9, 11, 0.82);
          border-color: rgba(255, 255, 255, 0.10);
          color: rgba(255, 255, 255, 0.76);
        }
        .ails-ai-review-card:not(:disabled):hover,
        .ails-ai-review-card:not(:disabled):focus-visible {
          background-color: rgba(39, 39, 42, 0.96) !important;
          border-color: rgba(255, 255, 255, 0.26) !important;
          color: rgba(255, 255, 255, 0.96) !important;
        }
        .ails-ai-review-glyph-error::before,
        .ails-ai-review-glyph-warning::before,
        .ails-ai-review-glyph-info::before {
          content: "●";
          display: block;
          font-size: 14px;
          line-height: 18px;
          text-align: center;
        }
        .ails-ai-review-glyph-error::before { color: #f87171; }
        .ails-ai-review-glyph-warning::before { color: #fbbf24; }
        .ails-ai-review-glyph-info::before { color: #38bdf8; }
      `}</style>
      <CodeWindowToolbar
            gradingContextControl={practiceWindow && pdfPath ? <PracticeGradingContext key={`${pdfPath}:${problemStorageBaseDir}`} kind="pdf" path={pdfPath} base_dir={problemStorageBaseDir} rootRef={practiceRootRef} active={isOpen} disabled={isProblemActionPending} /> : undefined}
            handleDragDown={handleDragDown}
            documentTitle={pdfPath.split(/[\\/]/).pop()}
            practiceWindow={practiceWindow}
            sidebarMode={sidebarMode}
            activeProblem={activeProblem}
            activeFile={activeFile}
            baseDir={baseDir}
            displayBasePath={displayBasePath}
            projectName={projectName}
            isDebugging={isDebugging}
            saveStatus={saveStatus}
            saveMsg={saveMsg}
            isSettingTemplate={isSettingTemplate}
            codeWorkspaceVisible={codeWorkspaceVisible}
            cancelRun={cancelRun}
            runActiveFile={runActiveFile}
            codeShortcuts={codeShortcuts}
            profileAction={profileAction}
            activeLanguageProfile={activeLanguageProfile}
            setProfileAction={setProfileAction}
            isAiReviewing={isAiReviewing}
            requestAiReview={requestAiReview}
            isSaving={isSaving}
            saveProject={saveProject}
            setIsShowHelp={setIsShowHelp}
            isShowHelp={isShowHelp}
            pdfFileControls={pdfFileNavigation ? practicePdfFiles : undefined}
            keymapProfile={keymapProfile}
            setIsSettingTemplate={setIsSettingTemplate}
            handleCloseWindow={handleCloseWindow}
          />
      {practiceWindow && <ProblemBatchProgressPanel />}

      {!isSettingTemplate && activeProblem && (
        <PracticeStudyHeader
            tutorControl={<PracticeTutorEntry />}
            activeProblem={activeProblem}
            roundControls={<>
              <PracticeRoundHistory key={`${activeProblemScope}:${activeProblem.grading_revision ?? 0}`} count={activeProblem.solve_history_count ?? Number(Boolean(activeProblem.last_grading))}
                load={() => loadPdfProblemHistory({ pdf_path: pdfPath, base_dir: problemStorageBaseDir, problem_id: activeProblem.id })} />
              {activeProblem.last_grading && <button type="button" className="code-sandbox-button" aria-label={t("다시 풀기")} disabled={practiceActionPending || isDebugging || isSaving} onClick={() => void retryActiveProblem()}><RotateCcw size={12} /><span>{t("다시 풀기")}</span></button>}
            </>}
            answerKeyControl={pdfPath ? <AnswerKeyControl key={pdfPath} problem={activeProblem} pdfPath={pdfPath} baseDir={problemStorageBaseDir} onProblemChange={onProblemChange} onOpenPdfPage={onOpenPdfPage} /> : undefined}
            isProblemActionPending={practiceActionPending}
            openProblemEditor={openProblemEditor}
            onReviewQueuedProblems={onReviewQueuedProblems}
            pendingReviewQueueCount={pendingReviewQueueCount}
            isProblemAnswerSaving={isProblemAnswerSaving}
            isAnalyzingProblems={isAnalyzingProblems}
            problemAutoReviewStatus={problemAutoReviewStatus}
            onReviewCurrentPage={onReviewCurrentPage}
            problemReviewQueue={problemReviewQueue}
            setIsProblemReviewQueueOpen={setIsProblemReviewQueueOpen}
            problemTypeMenuRef={problemTypeMenuRef}
            isProblemTypeMenuOpen={isProblemTypeMenuOpen}
            setIsProblemTypeMenuOpen={setIsProblemTypeMenuOpen}
            activeProblemBinaryPrompt={activeProblemBinaryPrompt}
            activeProblemAnswerType={activeProblemAnswerType}
            isProblemTypeUpdating={isProblemTypeUpdating}
            changeActiveProblemAnswerType={changeActiveProblemAnswerType}
            toggleActiveProblemTimer={toggleActiveProblemTimer}
            isProblemTimerUpdating={isProblemTimerUpdating}
            problemClockNow={problemClockNow}
            isProblemHintVisible={isProblemHintVisible}
            isProblemHintLoading={isProblemHintLoading}
            activeProblemHint={activeProblemHint}
            toggleActiveProblemHint={toggleActiveProblemHint}
            previousPracticeProblem={previousPracticeProblem}
            selectPracticeProblem={selectPracticeProblem}
            openActiveProblemAnswerEditor={openActiveProblemAnswerEditor}
            activeProblemAnswerInputType={activeProblemAnswerInputType}
            activeFile={activeFile}
            gradeActiveProblem={gradeActiveProblem}
            isProblemGrading={isProblemGrading}
            nextPracticeProblem={nextPracticeProblem}
          />
      )}

      <div className="relative min-h-0 flex flex-1 bg-[var(--practice-editor)]">
        {IDE_ENABLED && !isSettingTemplate && activeProblem && activeProblemAnswerType === "code" && (
          <div
            className="pointer-events-auto absolute right-3 top-[9.75rem] z-[70] max-h-[calc(100%-10.5rem)] w-[min(420px,calc(100%-1.5rem))] overflow-y-auto"
            data-problem-code-assistance="true"
          >
            <div className="space-y-2">
              {isProblemHintVisible && (
                <PracticeHintPanel
                  error={problemHintError}
                  hint={activeProblemHint}
                  loading={isProblemHintLoading}
                  onClose={() => setIsProblemHintVisible(false)}
                />
              )}
              <PracticeFeedbackPanel
                compact
                error={problemActionError}
                grade={displayedProblemGrade}
                mistakeNote={latestMistakeNote}
                onOpenPage={openPracticeTheoryPage}
                theory={displayedTheory}
              />
            </div>
          </div>
        )}
        {!isSettingTemplate && (
          <CodeProjectSidebar
            navigationFold={navigationFold}
            retryControls={<PracticeRetryControls total={practiceProblems.length} wrong={practiceProblems.filter(problem => (problem.last_solve_correct ?? problem.last_grading?.correct) === false).length} selected={selectedPracticeProblemIds.size}
              disabled={practiceActionPending || isDebugging || isSaving} mode={retrySession.mode} visibleCount={visiblePracticeProblems.length} onStart={mode => void retryProblems(mode)} onExit={retrySession.clear} />}
            sidebarPanelRef={sidebarPanelRef}
            handleSidebarWheel={handleSidebarWheel}
            sidebarWidth={sidebarWidth}
            sidebarListFontSize={sidebarListFontSize}
            practiceWindow={practiceWindow}
            sidebarMode={sidebarMode}
            pdfPath={pdfPath}
            isProblemActionPending={practiceActionPending}
            problemActionLockRef={problemActionLockRef}
            setSidebarMode={setSidebarMode}
            activeChapterProblems={activeChapterProblems}
            activeProblem={activeProblem}
            batchDialogAnsweredCount={batchDialogAnsweredCount}
            batchDialogChangedCount={batchDialogChangedCount}
            batchDialogProblems={batchDialogProblems}
            batchProblemHasAnswer={batchProblemHasAnswer}
            expandedPracticeChapters={expandedPracticeChapters}
            isAnalyzingProblems={isAnalyzingProblems}
            isLoadingProblems={isLoadingProblems}
            isPracticeSelectionMode={isPracticeSelectionMode}
            navigatorChapters={navigatorChapters}
            onReviewAllProblems={onReviewAllProblems}
            onReviewAllProblemsLocal={onReviewAllProblemsLocal}
            openProblemBatchDialog={openProblemBatchDialog}
            openProblemEditor={openProblemEditor}
            practiceProblems={visiblePracticeProblems}
            problemAnalysisError={problemAnalysisError}
            problemAutoReviewStatus={problemAutoReviewStatus}
            problemBatchDialogIds={problemBatchDialogIds}
            selectPracticeProblem={selectPracticeProblem}
            selectedPracticeProblemIds={selectedPracticeProblemIds}
            setExpandedPracticeChapters={setExpandedPracticeChapters}
            setIsPracticeSelectionMode={setIsPracticeSelectionMode}
            setProblemBatchDialogIds={setProblemBatchDialogIds}
            setSelectedPracticeProblemIds={setSelectedPracticeProblemIds}
            startProblemBatchGrading={startProblemBatchGrading}
            togglePracticeProblemSelection={togglePracticeProblemSelection}
            projectName={projectName}
            setIsAddingFile={setIsAddingFile}
            isAddingFile={isAddingFile}
            addFile={addFile}
            newFileName={newFileName}
            setNewFileName={setNewFileName}
            folders={folders}
            renamingFileId={renamingFileId}
            commitRename={commitRename}
            renameDraft={renameDraft}
            setRenameDraft={setRenameDraft}
            setRenamingFileId={setRenamingFileId}
            activeFileId={activeFileId}
            setActiveFileId={setActiveFileId}
            deleteFile={deleteFile}
            position={position}
            setContextMenu={setContextMenu}
            normalizedProjectFolderPath={normalizedProjectFolderPath}
            setIsCreatingProject={setIsCreatingProject}
            setNewProjectName={setNewProjectName}
            draggingProjectPath={draggingProjectPath}
            handleMoveProject={handleMoveProject}
            handleSwitchProject={handleSwitchProject}
            parentProjectFolderPath={parentProjectFolderPath}
            projectBrowserEntries={projectBrowserEntries}
            selectedProjectPath={selectedProjectPath}
            isManagedProblemProjectPath={isManagedProblemProjectPath}
            setSelectedProjectPath={setSelectedProjectPath}
            setDraggingProjectPath={setDraggingProjectPath}
            handleSidebarResizeDown={handleSidebarResizeDown}
          />
        )}

        <div className="relative min-w-0 flex-1">
          {isSettingTemplate ? (
            <CodeSettingsPanel
            consoleEncoding={consoleEncoding}
            changeConsoleEncoding={changeConsoleEncoding}
            settingsTab={settingsTab}
            setSettingsTab={setSettingsTab}
            setIsSettingTemplate={setIsSettingTemplate}
            handleSettingsContentWheel={handleSettingsContentWheel}
            settingsContentRef={settingsContentRef}
            settingsContentFontSize={settingsContentFontSize}
            keymapProfile={keymapProfile}
            changeKeymapProfile={changeKeymapProfile}
            resetAllCodeShortcuts={resetAllCodeShortcuts}
            shortcutMessage={shortcutMessage}
            recordingShortcutAction={recordingShortcutAction}
            shortcutOverridesByProfile={shortcutOverridesByProfile}
            setShortcutMessage={setShortcutMessage}
            setRecordingShortcutAction={setRecordingShortcutAction}
            codeShortcuts={codeShortcuts}
            changeCodeShortcut={changeCodeShortcut}
            resetCodeShortcut={resetCodeShortcut}
            editorFontSize={editorFontSize}
            updateEditorFontSize={updateEditorFontSize}
            sidebarListFontSize={sidebarListFontSize}
            adjustSidebarListFontSize={adjustSidebarListFontSize}
            aiReviewFontSize={aiReviewFontSize}
            adjustAiReviewFontSize={adjustAiReviewFontSize}
            adjustSettingsContentFontSize={adjustSettingsContentFontSize}
            settingLanguage={settingLanguage}
            setSettingLanguage={setSettingLanguage}
            customLanguageProfiles={customLanguageProfiles}
            customTemplateText={customTemplateText}
            setCustomTemplateText={setCustomTemplateText}
            saveCustomTemplate={saveCustomTemplate}
            templateSaveOk={templateSaveOk}
            applyCustomLanguageProfiles={applyCustomLanguageProfiles}
          />
          ) : practiceWindow && sidebarMode === "problems" && !activeProblem ? (
            <PracticeEmptyState loading={isAnalyzingProblems || isLoadingProblems} loadingLabel={isLoadingProblems ? t("저장된 문제 불러오는 중") : undefined} error={problemAnalysisError} />
          ) : !IDE_ENABLED && activeProblemAnswerType === "code" ? (
            <div className="p-5 text-sm" role="status">상업판에서는 코드 답안 편집·실행을 지원하지 않습니다. 문제 본문은 PDF에서 확인하고 기존 코드 답안은 개발판에서 열 수 있습니다.<PracticeTutorEntry question /></div>
          ) : sidebarMode === "problems" && activeProblem && activeProblemAnswerType !== "code" ? (
            <PracticeAnswerPanel
            tutorAction={<PracticeTutorEntry question />}
            activeProblem={activeProblem}
            activeProblemBinaryPrompt={activeProblemBinaryPrompt}
            isProblemAnswerSaving={isProblemAnswerSaving}
            problemAnswerIsDirty={problemAnswerIsDirty}
            activeProblemDisplayBlocks={activeProblemDisplayBlocks}
            isProblemHintVisible={isProblemHintVisible}
            problemHintError={problemHintError}
            activeProblemHint={activeProblemHint}
            isProblemHintLoading={isProblemHintLoading}
            setIsProblemHintVisible={setIsProblemHintVisible}
            problemAnswerEditorRef={problemAnswerEditorRef}
            activeProblemBinarySelections={activeProblemBinarySelections}
            problemAnswerText={problemAnswerText}
            isProblemActionPending={practiceActionPending}
            selectActiveProblemBinaryAnswer={selectActiveProblemBinaryAnswer}
            activeProblemAnswerType={activeProblemAnswerType}
            changeActiveProblemAnswerType={changeActiveProblemAnswerType}
            flushActiveProblemAnswerSave={flushActiveProblemAnswerSave}
            setProblemSelectedChoice={setProblemSelectedChoice}
            setProblemGradeResult={setProblemGradeResult}
            setProblemActionError={setProblemActionError}
            problemSelectedChoice={problemSelectedChoice}
            setProblemAnswerText={setProblemAnswerText}
            problemActionError={problemActionError}
            currentProblemFeedbackGrade={currentProblemFeedbackGrade}
            latestMistakeNote={latestMistakeNote}
            openPracticeTheoryPage={openPracticeTheoryPage}
            displayedTheory={displayedTheory}
            previousProblemFeedbackGrade={previousProblemFeedbackGrade}
          />
          ) : (
            <div
              className={`flex h-full min-h-0 flex-col bg-[var(--practice-editor)] ${activeProblemAnswerType === "code" ? "overflow-y-auto" : "overflow-hidden"}`}
              data-practice-code-scroll={activeProblemAnswerType === "code" ? "true" : undefined}
            >
              {IDE_ENABLED && !isSettingTemplate && activeProblem && activeProblemAnswerType === "code" && (
                <section
                  className="ails-code-layout-border-subtle shrink-0 border-b bg-[var(--practice-panel)] px-4 py-3 text-[var(--foreground)]"
                  data-practice-code-problem-prompt="true"
                >
                  <div className="min-w-0">
                    <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
                      <span className="text-[10px] font-bold text-[var(--brand)]">{t("문제 본문")}</span>
                      <div className="flex items-center gap-2"><span className="text-[9px] text-[var(--muted-foreground)] font-medium">{activeProblem.page}{t("쪽")}</span><PracticeQuestionCopyButton number={activeProblem.number} blocks={activeProblemDisplayBlocks} /></div>
                    </div>
                    <div className="pr-2 text-[13px] leading-relaxed font-medium text-[var(--foreground)]">
                      {activeProblemDisplayBlocks.length > 0
                        ? activeProblemDisplayBlocks.map((block, index) => (
                          block.kind !== "text"
                            ? (
                              <pre
                                key={`${block.kind}-${index}`}
                                data-pdf-problem-code-box={block.kind === "code" ? "true" : undefined}
                                data-pdf-problem-output-screen={block.kind === "output" ? "true" : undefined}
                                className={`my-2 max-w-full overflow-x-auto rounded-lg border px-3 py-2 font-mono text-[12px] leading-5 shadow-xs ${
                                  block.kind === "code"
                                    ? "border-[var(--border)] bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100"
                                    : "border-slate-700 bg-slate-900 dark:bg-black/80 text-slate-100 dark:text-zinc-100"
                                }`}
                              >
                                {block.text}
                              </pre>
                            )
                            : (
                              <div key={`${block.kind}-${index}`} className="whitespace-pre-wrap">
                                {block.text}
                              </div>
                            )
                        ))
                        : t("문제 본문은 PDF에서 확인하세요.")}
                    </div>
                  </div>
                </section>
              )}
              {practiceWindow && sidebarMode === "problems" && activeProblemAnswerType === "code" && (
                <PracticeCodeFiles files={files} activeFileId={activeFileId} onSelect={setActiveFileId}
                  adding={isAddingFile} onAddingChange={setIsAddingFile} name={newFileName} onNameChange={setNewFileName} onAdd={addFile}
                  disabled={!activeProblemProject || loadedProjectScopeRef.current !== codeProjectLoadScope(baseDir, activeProblemProject) || isSaving || isProblemActionPending || (practicePdfFiles.busy && !isAddingFile)}
                  error={saveStatus === "error" ? saveMsg : undefined} />
              )}
              {activeFile ? (
                <>
                  <div
                    className={`relative overflow-hidden bg-[var(--practice-editor)] ${activeProblemAnswerType === "code" ? "h-[70vh] min-h-[420px] shrink-0" : "min-h-0 flex-1"}`}
                    data-practice-code-editor-region={activeProblemAnswerType === "code" ? "true" : undefined}
                  >
                <Editor
                  height="100%"
                  theme={syntaxTheme}
                  path="ails-code-sandbox-active-file"
                  language={monacoLanguageForFile(activeFile)}
                  value={activeFile.code}
                  onChange={updateActiveFileCode}
                  beforeMount={handleEditorWillMount}
                  onMount={handleEditorDidMount}
                  loading={
                    <div className="flex h-full w-full items-center justify-center gap-2 font-mono text-xs text-[var(--muted-foreground)]">
                      <RefreshCw className="animate-spin text-[var(--brand)]" size={14} /> Monaco Editor loading...
                    </div>
                  }
                  options={{
                    minimap: { enabled: false },
                    wordWrap: "on",
                    lineNumbersMinChars: 3,
                    fontFamily: "Fira Code, Consolas, Monaco, monospace",
                    fontLigatures: true,
                    automaticLayout: true,
                    fixedOverflowWidgets: true,
                    mouseWheelZoom: false,
                    folding: true,
                    tabSize: 4,
                    insertSpaces: true,
                    detectIndentation: false,
                    autoIndent: "full",
                    formatOnPaste: true,
                    formatOnType: true,
                    autoClosingBrackets: "always",
                    autoClosingQuotes: "always",
                    autoSurround: "languageDefined",
                    trimAutoWhitespace: true,
                    editContext: false,
                     scrollBeyondLastLine: false,
                    scrollbar: workspaceEditorScrollbar,
                    dragAndDrop: true,
                    multiCursorModifier: "alt",
                    multiCursorMergeOverlapping: true,
                  }}
                  saveViewState
                />
              </div>

              {(debugOutput.visible || aiReviewVisible) && (
                <CodeExecutionResultPanel
            isConsoleResizeHovered={isConsoleResizeHovered}
            handleConsoleBorderMouseDown={handleConsoleBorderMouseDown}
            isConsoleResizing={isConsoleResizing}
            setIsConsoleResizeHovered={setIsConsoleResizeHovered}
            handleConsoleBorderMouseMove={handleConsoleBorderMouseMove}
            consoleHeight={consoleHeight}
            setBottomPanelTab={setBottomPanelTab}
            bottomPanelTab={bottomPanelTab}
            consoleStatus={consoleStatus}
            aiReviewVisible={aiReviewVisible}
            setAiReviewVisibleForScope={setAiReviewVisibleForScope}
            aiReviewScope={aiReviewScope}
            isAiReviewing={isAiReviewing}
            aiReview={aiReview}
            setIsConsoleInputSettingsOpen={setIsConsoleInputSettingsOpen}
            setDebugOutput={setDebugOutput}
            firstRunNoticeAcknowledged={firstRunNoticeAcknowledged}
            setFirstRunNoticeAcknowledged={setFirstRunNoticeAcknowledged}
            activeFile={activeFile}
            projectName={projectName}
            consoleReturnCode={consoleReturnCode}
            lastRunElapsed={lastRunElapsed}
            compilerDiagnostics={compilerDiagnostics}
            revealLine={revealLine}
            consoleOutputRef={consoleOutputRef}
            debugOutput={debugOutput}
            consoleTruncated={consoleTruncated}
            isDebugging={isDebugging}
            isConsoleInputSettingsOpen={isConsoleInputSettingsOpen}
            isConsoleInputRetained={isConsoleInputRetained}
            updateConsoleInputRetained={updateConsoleInputRetained}
            updateConsoleAutoInput={updateConsoleAutoInput}
            consoleAutoInput={consoleAutoInput}
            hasRunSession={Boolean(runSessionId)}
            consoleInputClosed={consoleInputClosed}
            isSendingConsoleInput={isSendingConsoleInput}
            submitConsoleInput={submitConsoleInput}
            setConsoleInput={setConsoleInput}
            consoleInputRef={consoleInputRef}
            consoleInput={consoleInput}
            aiReviewPanelRef={aiReviewPanelRef}
            handleAiReviewWheel={handleAiReviewWheel}
            aiReviewEvaluatedSignature={aiReviewEvaluatedSignature}
            files={files}
            requestAiReview={requestAiReview}
            aiReviewPhase={aiReviewPhase}
            aiReviewError={aiReviewError}
            revealIssue={revealIssue}
          />
              )}
                </>
              ) : (
                <div
                  className="flex min-h-0 flex-1 items-center justify-center font-mono text-xs text-[var(--muted-foreground)]"
                  data-practice-code-empty-editor="true"
                >
                  {t("파일을 선택하거나 새 파일을 추가하세요.")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isProblemReviewQueueOpen && (
        <ProblemReviewQueueDialog
          isReviewQueueSaving={isReviewQueueSaving}
          problemActionError={problemActionError}
          problemReviewQueue={problemReviewQueue}
          reviewQueueEditor={reviewQueueEditor}
          saveReviewQueueResolution={saveReviewQueueResolution}
          selectReviewQueueCandidate={selectReviewQueueCandidate}
          setIsProblemReviewQueueOpen={setIsProblemReviewQueueOpen}
          setReviewQueueEditor={setReviewQueueEditor}
        />
      )}

      {isOpen && problemEditDialog && (
        <ProblemEditDialog
          isProblemEditing={isProblemEditing}
          problemActionError={problemActionError}
          problemEditDialog={problemEditDialog}
          saveProblemEdits={saveProblemEdits}
          setProblemEditDialog={setProblemEditDialog}
        />
      )}

      {contextMenu.visible && (
        <div
          className="absolute z-[99] min-w-[120px] rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 font-sans text-[11px] text-[var(--foreground)] shadow-2xl backdrop-blur-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.type === "project" ? (
            <>
              <div className="px-3 py-1 text-[10px] text-[var(--muted-foreground)] border-b border-[var(--border)] truncate max-w-[150px]">
                📁 {contextMenu.projectName}
              </div>
              {isManagedProblemProjectPath(contextMenu.projectName) && (
                <div className="max-w-52 px-3 py-1.5 text-[9px] leading-4 text-amber-700 dark:text-amber-300">
                  {t("PDF 문제 상태와 연결된 폴더라서 이름 변경·이동·삭제가 보호됩니다.")}</div>
              )}
              <button
                className="flex w-full items-center px-3 py-1.5 text-left font-medium hover:bg-[var(--muted)]/50 disabled:cursor-not-allowed disabled:opacity-35"
                disabled={isManagedProblemProjectPath(contextMenu.projectName)}
                onClick={() => {
                  setRenamingProjectPath(contextMenu.projectName)
                  setProjectRenameDraft(projectBaseName(contextMenu.projectName))
                  setContextMenu((prev) => ({ ...prev, visible: false }))
                }}
                type="button"
              >
                {t("이름 변경 (Rename)")}</button>
              <button
                className="flex w-full items-center border-t border-[var(--border)] px-3 py-1.5 text-left font-medium text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                disabled={isManagedProblemProjectPath(contextMenu.projectName)}
                onClick={() => {
                  void handleDeleteProject(contextMenu.projectName)
                  setContextMenu((prev) => ({ ...prev, visible: false }))
                }}
                type="button"
              >
                {t("삭제 (Delete)")}</button>
            </>
          ) : contextMenu.type === "project-space" ? (
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-medium hover:bg-[var(--muted)]/50"
              onClick={() => {
                setContextMenu((prev) => ({ ...prev, visible: false }))
                setIsCreatingProject(true)
                setNewProjectName("")
              }}
              type="button"
            >
              <Folder size={12} />
              {t("폴더 생성")}</button>
          ) : (
            <>
              <button
                className="flex w-full items-center px-3 py-1.5 text-left font-medium hover:bg-[var(--muted)]/50"
                onClick={() => {
                  const targetFile = files.find((f) => f.id === contextMenu.fileId)
                  if (targetFile) {
                    startRename(targetFile)
                  }
                  setContextMenu((prev) => ({ ...prev, visible: false }))
                }}
                type="button"
              >
                {t("이름 변경 (F2)")}</button>
              <button
                className="flex w-full items-center border-t border-[var(--border)] px-3 py-1.5 text-left font-medium text-red-600 dark:text-red-400 hover:bg-red-600 hover:text-white"
                onClick={() => {
                  deleteFile(contextMenu.fileId)
                  setContextMenu((prev) => ({ ...prev, visible: false }))
                }}
                type="button"
              >
                {t("삭제")}</button>
            </>
          )}
        </div>
      )}
      {isCreatingProject && (
        <div
          className="absolute inset-0 z-[110] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => {
            setIsCreatingProject(false)
            setNewProjectName("")
          }}
        >
          <form
            className="w-full max-w-[320px] rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--foreground)] shadow-2xl"
            onSubmit={handleCreateProjectSubmit}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--brand)]/20 bg-[var(--brand-soft)]/25 text-[var(--brand)]">
                <Plus size={14} />
              </div>
              <div>
                <h3 className="text-xs font-bold">{t("새 프로젝트 폴더")}</h3>
                <p className="text-[9px] text-[var(--muted-foreground)]">{t("생성할 새 프로젝트 이름을 입력하세요.")}</p>
              </div>
            </div>

            <input
              autoFocus
              className="mb-3 h-8 w-full rounded border border-[var(--border)] bg-white dark:bg-white/5 px-2 font-mono text-[10px] text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--brand)]"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder={t("예: practice_2")}
              spellCheck={false}
            />

            <div className="flex justify-end gap-2">
              <button
                className="rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 px-2 py-1 text-[9px] font-bold text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => {
                  setIsCreatingProject(false)
                  setNewProjectName("")
                }}
                type="button"
              >
                {t("취소")}</button>
              <button
                className="rounded bg-[var(--brand)] px-2 py-1 text-[9px] font-bold text-white hover:bg-[var(--brand)]/80"
                type="submit"
              >
                {t("생성")}</button>
            </div>
          </form>
        </div>
      )}
      {renamingProjectPath && (
        <div
          className="absolute inset-0 z-[110] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
          onClick={() => {
            setRenamingProjectPath("")
            setProjectRenameDraft("")
          }}
        >
          <form
            className="w-full max-w-[320px] rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--foreground)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              void handleRenameProject(renamingProjectPath, projectRenameDraft)
            }}
          >
            <div className="mb-3">
              <h3 className="text-xs font-bold">{t("프로젝트 폴더 이름 변경")}</h3>
              <p className="mt-1 truncate text-[9px] text-[var(--muted-foreground)]" title={renamingProjectPath}>{renamingProjectPath}</p>
            </div>
            <input
              autoFocus
              className="mb-3 h-8 w-full rounded border border-[var(--border)] bg-white dark:bg-white/5 px-2 font-mono text-[10px] text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--brand)]"
              onChange={(event) => setProjectRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setRenamingProjectPath("")
                  setProjectRenameDraft("")
                }
              }}
              spellCheck={false}
              value={projectRenameDraft}
            />
            <div className="flex justify-end gap-2">
              <button
                className="rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 px-2 py-1 text-[9px] font-bold text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => {
                  setRenamingProjectPath("")
                  setProjectRenameDraft("")
                }}
                type="button"
              >
                {t("취소")}</button>
              <button className="rounded bg-[var(--brand)] px-2 py-1 text-[9px] font-bold text-white hover:bg-[var(--brand)]/80" type="submit">
                {t("변경")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
})
