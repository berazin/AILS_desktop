import { useEffect, useRef, type RefObject } from "react"

import {
  buildWorkspaceSessionState,
  writeWorkspaceSessionState,
  type WorkspaceSessionState,
} from "../../../lib/workspace-session-state.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { workspaceWindowStorage } from "../../../lib/workspace-window-storage.ts"

type UseWorkspaceSessionPersistenceOptions = {
  chat: {
    draft: string
    draftRef: RefObject<string>
    open: boolean
  }
  codeSandbox: {
    activeFileName: string
    baseDir: string
    latestRef: RefObject<WorkspaceSessionState["codeSandbox"] | null>
    open: boolean
    projectName: string
    session: WorkspaceSessionState["codeSandbox"] | null
  }
  latestSessionRef: RefObject<WorkspaceSessionState | null>
  layout: {
    leftSidebarWidth: number
  }
  pdfPage: number
  pdfViewer: {
    floating: boolean
    position: { x: number; y: number }
    size: { height: number; width: number }
  }
  viewer: {
    document: ViewerDocument | null
    fullscreenOpen: boolean
  }
}

export function useWorkspaceSessionPersistence({
  chat,
  codeSandbox,
  latestSessionRef,
  layout,
  pdfPage,
  pdfViewer,
  viewer,
}: UseWorkspaceSessionPersistenceOptions) {
  const saveTimerRef = useRef<number | null>(null)

  const collect = useEventCallback(() => {
    const codeState = codeSandbox.latestRef.current ?? codeSandbox.session ?? undefined
    return buildWorkspaceSessionState({
      material: viewer.document?.loading ? latestSessionRef.current?.material : viewer.document?.file_path
        ? {
            filePath: viewer.document.file_path,
            kind: viewer.document.kind,
            pdfPage: viewer.document.kind === "pdf" || viewer.document.rendered_file_path ? pdfPage : undefined,
          }
        : undefined,
      viewer: { fullscreenOpen: viewer.fullscreenOpen },
      pdfViewer,
      codeSandbox: {
        open: codeSandbox.open,
        baseDir: codeState?.baseDir || codeSandbox.baseDir,
        projectName: codeState?.projectName ?? codeSandbox.projectName,
        activeFileName: codeState?.activeFileName ?? codeSandbox.activeFileName,
        mode: codeState?.mode,
      },
      chatbot: {
        open: chat.open,
        draft: chat.draftRef.current,
      },
      layout,
    })
  })

  const flush = useEventCallback(() => {
    latestSessionRef.current = collect()
    writeWorkspaceSessionState(workspaceWindowStorage(), latestSessionRef.current)
  })

  useEffect(() => {
    latestSessionRef.current = collect()
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      flush()
    }, 250)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [
    chat.draft,
    chat.open,
    codeSandbox.activeFileName,
    codeSandbox.baseDir,
    codeSandbox.open,
    codeSandbox.projectName,
    codeSandbox.session,
    collect,
    flush,
    latestSessionRef,
    layout.leftSidebarWidth,
    pdfPage,
    pdfViewer.floating,
    pdfViewer.position,
    pdfViewer.size,
    viewer.document?.file_path,
    viewer.document?.kind,
    viewer.document?.loading,
    viewer.fullscreenOpen,
  ])

  useEffect(() => {
    const flushLatest = () => {
      if (latestSessionRef.current) {
        writeWorkspaceSessionState(workspaceWindowStorage(), latestSessionRef.current)
      }
    }
    window.addEventListener("pagehide", flushLatest)
    window.addEventListener("beforeunload", flushLatest)
    document.addEventListener("visibilitychange", flushLatest)
    return () => {
      window.removeEventListener("pagehide", flushLatest)
      window.removeEventListener("beforeunload", flushLatest)
      document.removeEventListener("visibilitychange", flushLatest)
    }
  }, [latestSessionRef])
}
