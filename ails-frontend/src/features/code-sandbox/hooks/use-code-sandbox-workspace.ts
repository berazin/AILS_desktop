import { IDE_ENABLED } from "../../../edition.ts"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import { t } from "../../../lib/i18n.ts"
import { pdfPracticeSplitLayout } from "../../../lib/pdf-view-layout.ts"
import { titleFromPath, type ViewerDocument } from "../../../lib/viewer-document.ts"
import { type CodeSandboxWindowMode, type WorkspaceSessionState } from "../../../lib/workspace-session-state.ts"
import {
  CODING_SPLIT_MIN_EDITOR_WIDTH,
  CODING_SPLIT_MIN_PDF_WIDTH,
  DESKTOP_TITLE_BAR_HEIGHT,
  useCodingSplitLayout,
} from "./use-coding-split-layout.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import { usePracticeTabSessions, type PracticePdfPlacement } from "./use-practice-tab-sessions.ts"
import { practiceIdeLayout } from "../lib/practice-ide-layout.ts"

type Point = { x: number; y: number }
type Size = { width: number; height: number }
type CodeSandboxSession = NonNullable<WorkspaceSessionState["codeSandbox"]>

type UseCodeSandboxWorkspaceOptions = {
  tutor?: import("../../practice-tutor/hooks/use-practice-tutor-workspace.ts").PracticeTutorWorkspace
  initialWorkspaceSession: WorkspaceSessionState | null
  mdSavePath: string
  mountForPath: string
  pdfViewer: {
    floating: boolean
    position: Point
    setFloating: Dispatch<SetStateAction<boolean>>
    setPosition: Dispatch<SetStateAction<Point>>
    setSize: Dispatch<SetStateAction<Size>>
    size: Size
  }
  setWorkspaceSurface: Dispatch<SetStateAction<WorkspaceSurface>>
  viewerDocument: ViewerDocument | null
  documentActive?: boolean
  documentCodeActive?: boolean
  openDocumentIds?: string[]
  viewportSize: Size
}

function persistPdfFloating(floating: boolean) {
  localStorage.setItem("ails_pdf_floating", String(floating))
}

export function useCodeSandboxWorkspace({
  tutor,
  initialWorkspaceSession,
  mdSavePath,
  mountForPath,
  pdfViewer,
  setWorkspaceSurface,
  viewerDocument,
  documentActive = true,
  documentCodeActive = false,
  openDocumentIds,
  viewportSize,
}: UseCodeSandboxWorkspaceOptions) {
  const initialSession = !IDE_ENABLED && initialWorkspaceSession?.codeSandbox?.mode === "code" ? null : initialWorkspaceSession?.codeSandbox ?? null
  const {
    floating: pdfViewerFloating,
    position: pdfViewerPosition,
    setFloating: setPdfViewerFloating,
    setPosition: setPdfViewerPosition,
    setSize: setPdfViewerSize,
    size: pdfViewerSize,
  } = pdfViewer
  const viewerFilePath = viewerDocument?.file_path ?? ""
  const [mounted, setMounted] = useState(() => initialSession?.open === true)
  const tabs = usePracticeTabSessions(documentActive ? viewerDocument?.id ?? "" : "", viewerFilePath, initialWorkspaceSession, openDocumentIds)
  const updateTab = tabs.update
  const { open, snapped: viewerSnapped, initialFileName, session } = tabs
  const windowKey = tabs.instanceKey || tabs.key
  const [keyboardOwner, setKeyboardOwner] = useState("")
  const keyboardCaptured = open && keyboardOwner === tabs.key
  const setKeyboardCaptured = useEventCallback((captured: boolean) => setKeyboardOwner(captured ? tabs.key : ""))
  const [nameDialogOpen, setNameDialogOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState(() => initialSession?.activeFileName || "main.py")
  const [errorBoundaryKey, setErrorBoundaryKey] = useState(0)
  const latestSessionRef = useRef<WorkspaceSessionState["codeSandbox"] | null>(initialSession)
  const previousPlacementRef = useRef<{ key: string; active: boolean; restore: PracticePdfPlacement | null } | null>(null)

  const pathInfo = useMemo(() => {
    const fallback = {
      baseDir: mdSavePath ? `${mdSavePath.replace(/\\/g, "/")}/.codes` : "",
      projectName: t("실습_1"),
    }

    if (!viewerFilePath) return fallback

    const filePath = viewerFilePath.replace(/\\/g, "/")
    const pathParts = filePath.split("/").filter(Boolean)
    const semesterIndex = pathParts.findIndex((part) => /^\d+\s*학년\s*\d+\s*학기$/.test(part.trim()))

    if (semesterIndex >= 0 && pathParts[semesterIndex + 1]) {
      const basePrefix = filePath.startsWith("/") ? "/" : ""
      const lectureBase = basePrefix + pathParts.slice(0, semesterIndex + 2).join("/")
      return {
        baseDir: `${lectureBase}/.codes`,
        projectName: t("실습_1"),
      }
    }

    const normalizedSavePath = mdSavePath.replace(/\\/g, "/")
    const parentDir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : normalizedSavePath
    const fileName = titleFromPath(filePath) || "document"
    return {
      baseDir: parentDir ? `${parentDir}/.${fileName}.codes` : `.${fileName}.codes`,
      projectName: t("실습_1"),
    }
  }, [mdSavePath, viewerFilePath])

  const activeBaseDir = session?.baseDir || pathInfo.baseDir
  const activeProjectName = session?.projectName ?? pathInfo.projectName
  const activeFileName = session?.activeFileName ?? initialFileName ?? "main.py"
  const codingModeActive = open && viewerSnapped && documentActive && Boolean(viewerDocument)
  const alongsideIde = codingModeActive && documentCodeActive
  const idePracticeLayout = practiceIdeLayout(viewportSize)
  const alongsideLayout = alongsideIde && tutor?.open && tutor.layout?.mode === "column"
    ? { x: tutor.layout.split.editor.position.x, y: tutor.layout.split.editor.position.y,
      ...tutor.layout.split.editor.size } : idePracticeLayout
  const splitLayout = useCodingSplitLayout({
    tutor: session?.mode === "problems" ? tutor : undefined,
    active: codingModeActive && !alongsideIde,
    floating: pdfViewerFloating,
    setPdfViewerPosition,
    setPdfViewerSize,
    viewportSize,
  })

  useLayoutEffect(() => {
    latestSessionRef.current = session ?? null
  }, [session])

  useLayoutEffect(() => {
    const previous = previousPlacementRef.current
    if (previous?.active && previous.key !== windowKey && !codingModeActive && previous.restore) {
      setPdfViewerPosition(previous.restore.position)
      setPdfViewerSize(previous.restore.size)
      setPdfViewerFloating(previous.restore.floating)
      persistPdfFloating(previous.restore.floating)
    }
    if (codingModeActive) {
      setPdfViewerFloating(!alongsideIde)
      persistPdfFloating(!alongsideIde)
    }
    previousPlacementRef.current = { key: windowKey, active: codingModeActive, restore: tabs.pdfRestore }
  }, [codingModeActive, alongsideIde, windowKey, tabs.pdfRestore, setPdfViewerFloating, setPdfViewerPosition, setPdfViewerSize])

  useEffect(() => {
    if (mountForPath && open) setMounted(true)
  }, [mountForPath, open])

  useEffect(() => {
    if (pdfViewerFloating && !codingModeActive && !viewerSnapped && !open) {
      setPdfViewerFloating(false)
      persistPdfFloating(false)
    }
  }, [codingModeActive, open, pdfViewerFloating, setPdfViewerFloating, viewerSnapped])

  const updateSession = useEventCallback((next: CodeSandboxSession) => {
    latestSessionRef.current = next
    tabs.update({ session: next }, next.mode)
  })

  const handleSessionChange = useCallback((state: { baseDir: string; projectName: string; activeFileName: string }) => {
    const next = { open, ...state, mode: latestSessionRef.current?.mode }
    const current = latestSessionRef.current
    if (
      current?.open === next.open
      && current?.baseDir === next.baseDir
      && current?.projectName === next.projectName
      && current?.activeFileName === next.activeFileName
      && current?.mode === next.mode
    ) {
      return
    }
    latestSessionRef.current = next
    updateTab({ session: next })
  }, [open, updateTab])

  const markClosed = useEventCallback(() => {
    setKeyboardCaptured(false)
    tabs.update((current) => {
      if (!current.session) return { open: false }
      const next = { ...current.session, open: false }
      latestSessionRef.current = next
      return { open: false, session: next }
    })
  })

  const exitCodingMode = useEventCallback(() => {
    const previousPdf = tabs.pdfRestore
    tabs.update({ open: false, snapped: false, pdfRestore: null })
    markClosed()

    const nextFloating = documentCodeActive ? false : previousPdf?.floating ?? false
    setPdfViewerFloating(nextFloating)
    persistPdfFloating(nextFloating)
    if (previousPdf) {
      setPdfViewerPosition(previousPdf.position)
      setPdfViewerSize(previousPdf.size)
      localStorage.setItem("ails_pdf_position", JSON.stringify(previousPdf.position))
      localStorage.setItem("ails_pdf_size", JSON.stringify(previousPdf.size))
    }
  })

  const close = useEventCallback(() => {
    if (viewerSnapped) {
      exitCodingMode()
      return
    }
    markClosed()
  })

  const openWorkspace = useEventCallback((preferredSession?: CodeSandboxSession, mode?: CodeSandboxWindowMode) => {
    setWorkspaceSurface("document")
    const hasViewer = Boolean(viewerDocument)
    const hasPdf = Boolean(viewerDocument && (viewerDocument.kind === "pdf" || viewerDocument.rendered_file_path))
    // 문제풀이(PDF 문제 학습)와 코드(독립 에디터)는 진입 경로가 분리되어 있다.
    const windowMode: CodeSandboxWindowMode
      = mode ?? preferredSession?.mode ?? session?.mode ?? (hasViewer ? "problems" : "code")

    if (!IDE_ENABLED && windowMode === "code") return

    const openSandbox = () => {
      const candidate = preferredSession ?? session
      const canRestoreSession = candidate?.baseDir === pathInfo.baseDir
      const nextProjectName = canRestoreSession
        ? candidate?.projectName ?? pathInfo.projectName
        : pathInfo.projectName
      const nextFileName = canRestoreSession
        ? candidate?.activeFileName ?? initialFileName ?? "main.py"
        : initialFileName || "main.py"
      const nextSession = {
        open: true,
        baseDir: preferredSession?.baseDir ?? pathInfo.baseDir,
        projectName: preferredSession?.projectName ?? nextProjectName,
        activeFileName: preferredSession?.activeFileName ?? nextFileName,
        mode: windowMode,
      }
      tabs.update({ open: true, session: nextSession, initialFileName: nextSession.activeFileName, snapped: windowMode === "problems" && hasViewer }, windowMode)
      latestSessionRef.current = nextSession
      setMounted(true)
    }

    if (hasViewer && windowMode === "problems") {
      tabs.update({ snapped: true }, "problems")
      const savedSplit = Number(localStorage.getItem("ails_coding_split_x"))
      const practiceLayout = pdfPracticeSplitLayout({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        splitX: Number.isFinite(savedSplit) && savedSplit > 0 ? savedSplit : Math.floor(window.innerWidth / 2),
        titleBarHeight: DESKTOP_TITLE_BAR_HEIGHT,
        minEditorWidth: CODING_SPLIT_MIN_EDITOR_WIDTH,
        minPdfWidth: CODING_SPLIT_MIN_PDF_WIDTH,
      })
      const nextSplitX = practiceLayout.splitX

      localStorage.setItem("ails_sandbox_position", JSON.stringify(practiceLayout.editor.position))
      localStorage.setItem("ails_sandbox_size", JSON.stringify(practiceLayout.editor.size))
      splitLayout.setCodingSplitX(nextSplitX)
      localStorage.setItem("ails_coding_split_x", String(nextSplitX))

      if (hasPdf && !documentCodeActive) {
        if (!codingModeActive && !tabs.pdfRestore) {
          tabs.update({ pdfRestore: {
            floating: pdfViewerFloating,
            position: { ...pdfViewerPosition },
            size: { ...pdfViewerSize },
          } }, "problems")
        }
        setPdfViewerFloating(true)
        persistPdfFloating(true)
        setPdfViewerPosition(practiceLayout.pdf.position)
        setPdfViewerSize(practiceLayout.pdf.size)
        localStorage.setItem("ails_pdf_position", JSON.stringify(practiceLayout.pdf.position))
        localStorage.setItem("ails_pdf_size", JSON.stringify(practiceLayout.pdf.size))
      }

      if (!open || session?.mode !== "problems" || activeBaseDir !== pathInfo.baseDir) openSandbox()
      return
    }

    if (windowMode === "code") {
      if (open && viewerSnapped) {
        // 분할 문제풀이로 열려 있으면 PDF 배치를 복구하고 독립 에디터로 전환한다.
        exitCodingMode()
        openSandbox()
        return
      }
      if (open && session?.mode !== "code") {
        updateSession({
          open: true,
          baseDir: session?.baseDir ?? pathInfo.baseDir,
          projectName: session?.projectName ?? pathInfo.projectName,
          activeFileName: session?.activeFileName ?? initialFileName ?? "main.py",
          mode: "code",
        })
        return
      }
      if (!open) openSandbox()
      return
    }

    if (open) {
      tabs.update({ snapped: false, open: false })
    } else {
      openSandbox()
    }
  })

  const submitName = useEventCallback((nextFileName: string) => {
    tabs.update({ initialFileName: nextFileName, open: true }, session?.mode ?? "code")
    updateSession({
      open: true,
      baseDir: pathInfo.baseDir,
      projectName: pathInfo.projectName,
      activeFileName: nextFileName,
      mode: session?.mode ?? "code",
    })
    setNameDialogOpen(false)
    setMounted(true)
  })

  const retryAfterError = useEventCallback(() => {
    setErrorBoundaryKey((current) => current + 1)
    close()
  })

  return {
    actions: {
      close,
      exitCodingMode,
      handleSessionChange,
      open: openWorkspace,
      openCode: () => openWorkspace(undefined, "code"),
      retryAfterError,
      replaceDocument: tabs.replaceDocument,
    },
    active: {
      baseDir: activeBaseDir,
      fileName: activeFileName,
      initialFileName,
      projectName: activeProjectName,
    },
    dialog: {
      cancel: () => setNameDialogOpen(false),
      draft: nameDraft,
      open: nameDialogOpen,
      setDraft: setNameDraft,
      submit: submitName,
    },
    layout: { ...splitLayout, snappedCodeLayout: alongsideIde ? alongsideLayout : splitLayout.snappedCodeLayout },
    pathInfo,
    session: {
      latestRef: latestSessionRef,
      value: session,
    },
    state: {
      codingModeActive,
      alongsideIde,
      reservedWidth: alongsideIde ? idePracticeLayout.width : 0,
      errorBoundaryKey,
      keyboardCaptured,
      mode: session?.mode,
      windowKey,
      mounted,
      open,
      setKeyboardCaptured,
    },
  }
}

export type CodeSandboxWorkspace = ReturnType<typeof useCodeSandboxWorkspace>
