import { useCallback, useEffect, useRef, useState } from "react"

import { t } from "../../../lib/i18n.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"

export type WorkspaceNavigationEntry = {
  id: string
  title: string
  surface: "home" | "dashboard" | "document" | "code"
  filePath?: string
  folderPath?: string
}

type NavigationDocument = Pick<ViewerDocument, "file_path" | "id" | "title">

type UseWorkspaceNavigationHistoryOptions = {
  onBack?: () => void
  onForward?: () => void
  onNavigate: (target: WorkspaceNavigationEntry) => void | Promise<void>
  selectedDocument: NavigationDocument | null
  sessionDocument: NavigationDocument | null
  workspaceSurface: WorkspaceSurface
  pageTabId?: string
  codePageId?: string
  homeFolderPath?: string
}

function isSameEntry(left: WorkspaceNavigationEntry, right: WorkspaceNavigationEntry) {
  if (left.surface !== right.surface) return false
  if (left.surface === "dashboard") {
    return left.id === right.id && normalizePath(left.folderPath) === normalizePath(right.folderPath)
  }
  if (left.id === right.id) return true
  return Boolean(left.filePath && right.filePath
    && normalizePath(left.filePath) === normalizePath(right.filePath))
}

function normalizePath(path = "") {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export function useWorkspaceNavigationHistory({
  onBack,
  onForward,
  onNavigate,
  selectedDocument,
  sessionDocument,
  workspaceSurface,
  pageTabId,
  codePageId,
  homeFolderPath,
}: UseWorkspaceNavigationHistoryOptions) {
  const [history, setHistory] = useState<WorkspaceNavigationEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [navigationRevision, setNavigationRevision] = useState(0)
  const observedEntryRef = useRef<WorkspaceNavigationEntry | null>(null)
  const navigationTargetRef = useRef<{
    target: WorkspaceNavigationEntry; source: WorkspaceNavigationEntry; index: number; sourceIndex: number; settled: boolean
  } | null>(null)

  useEffect(() => {
    let nextItem: WorkspaceNavigationEntry | null = null
    if (workspaceSurface === "home") {
      nextItem = { id: pageTabId ?? "__HOME__", title: t("홈"), surface: "home" }
    } else if (workspaceSurface === "dashboard") {
      nextItem = { id: pageTabId ?? "__DASHBOARD__", title: t("AI 학습 관리자"), surface: "dashboard", folderPath: homeFolderPath }
    } else if (workspaceSurface === "code" && codePageId) {
      nextItem = { id: codePageId, title: t("코드"), surface: "code" }
    } else if (workspaceSurface === "document") {
      const document = selectedDocument ?? sessionDocument
      if (document) {
        nextItem = {
          id: document.id,
          title: document.title,
          surface: "document",
          filePath: document.file_path,
        }
      }
    }
    if (!nextItem) return
    observedEntryRef.current = nextItem

    // Keep the target until an asynchronous reopen has produced a document.
    // Loading and ready IDs for the same file represent one history visit.
    const navigationTarget = navigationTargetRef.current
    const restoringTarget = navigationTarget && isSameEntry(navigationTarget.target, nextItem)
    if (navigationTarget) {
      if (!restoringTarget && isSameEntry(navigationTarget.source, nextItem)) {
        // A routing/profile lookup may still show the page we are leaving.
        // Recording it here would truncate Forward and append a false visit.
        if (!navigationTarget.settled) return
        navigationTargetRef.current = null
        setHistory(current => current.map((item, index) => index === navigationTarget.index ? navigationTarget.target : item))
        setHistoryIndex(navigationTarget.sourceIndex)
        return
      }
      // A different user navigation supersedes the pending restore. Otherwise
      // keep watching through loading so a failed reopen can roll back its index.
      if (!restoringTarget || navigationTarget.settled) navigationTargetRef.current = null
    }

    setHistory((currentHistory) => {
      const current = currentHistory[historyIndex]
      if (current && (restoringTarget || isSameEntry(current, nextItem))) {
        if (current.id === nextItem.id && current.title === nextItem.title && current.filePath === nextItem.filePath && current.folderPath === nextItem.folderPath) return currentHistory
        return currentHistory.map((item, index) => index === historyIndex ? nextItem : item)
      }
      const updated = [...currentHistory.slice(0, historyIndex + 1), nextItem]
      setHistoryIndex(updated.length - 1)
      return updated
    })
  }, [historyIndex, selectedDocument, sessionDocument, workspaceSurface, pageTabId, codePageId, homeFolderPath, navigationRevision])

  const navigateBy = useCallback((offset: -1 | 1) => {
    const targetIndex = historyIndex + offset
    const target = history[targetIndex]
    if (!target) return
    const navigation = { target, source: observedEntryRef.current ?? history[historyIndex], index: targetIndex, sourceIndex: historyIndex, settled: false }
    navigationTargetRef.current = navigation
    setHistoryIndex(targetIndex)
    const settled = () => {
      navigation.settled = true
      if (navigationTargetRef.current === navigation) setNavigationRevision(current => current + 1)
    }
    try {
      const pending = onNavigate(target)
      if (pending) void pending.then(settled, settled)
      else navigation.settled = true
    } catch (error) {
      settled()
      throw error
    }
  }, [history, historyIndex, onNavigate])

  const goBack = useCallback(() => navigateBy(-1), [navigateBy])
  const goForward = useCallback(() => navigateBy(1), [navigateBy])

  useEffect(() => {
    const handleNavigationMouseButton = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault()
        if (onBack) onBack()
        else goBack()
      } else if (event.button === 4) {
        event.preventDefault()
        if (onForward) onForward()
        else goForward()
      }
    }
    const preventNativeMouseNavigation = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault()
    }
    window.addEventListener("mouseup", handleNavigationMouseButton)
    window.addEventListener("auxclick", preventNativeMouseNavigation)
    return () => {
      window.removeEventListener("mouseup", handleNavigationMouseButton)
      window.removeEventListener("auxclick", preventNativeMouseNavigation)
    }
  }, [goBack, goForward, onBack, onForward])

  return {
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex < history.length - 1,
    goBack,
    goForward,
  }
}
