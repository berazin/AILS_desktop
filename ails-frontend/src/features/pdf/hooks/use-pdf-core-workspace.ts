import { useEffect, useRef, useState } from "react"

import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { usePdfAnnotationWorkflows } from "./use-pdf-annotation-workflows.ts"
import { usePdfController } from "./use-pdf-controller.ts"
import { usePdfFloatingWindow } from "./use-pdf-floating-window.ts"
import { usePdfPageStateSyncWorkflow } from "./use-pdf-navigation-workflows.ts"
import { readSavedPdfPages } from "../lib/pdf-page-state.ts"
import { t } from "../../../lib/i18n.ts"
import type { WorkspaceSessionState } from "../../../lib/workspace-session-state.ts"
import { normalizedMaterialPath } from "../../../lib/material-navigation.ts"

type UsePdfCoreWorkspaceOptions = {
  initialWorkspaceSession: WorkspaceSessionState | null
  mdSavePath: string
}

export function usePdfCoreWorkspace({
  initialWorkspaceSession,
  mdSavePath,
}: UsePdfCoreWorkspaceOptions) {
  const [viewerFullscreenOpen, setViewerFullscreenOpen] = useState(
    () => initialWorkspaceSession?.viewer?.fullscreenOpen === true,
  )
  const [annotationPaletteOpen, setAnnotationPaletteOpen] = useState(false)
  const annotationPaletteRef = useRef<HTMLDivElement | null>(null)
  const controller = usePdfController({
    readSavedPages: readSavedPdfPages,
  })
  const annotationWorkflows = usePdfAnnotationWorkflows(controller)
  const floatingWindow = usePdfFloatingWindow(initialWorkspaceSession)
  const { isEditingPage, pageInputRef } = controller.document

  usePdfPageStateSyncWorkflow({
    loadedForPathRef: controller.document.pdfPageStateLoadedForPathRef,
    mdSavePath,
    normalizePath: normalizedMaterialPath,
    setPages: controller.document.setPdfPageByDocument,
  })

  useEffect(() => {
    if (isEditingPage && pageInputRef.current) {
      pageInputRef.current.focus()
      pageInputRef.current.select()
    }
  }, [isEditingPage, pageInputRef])

  useEffect(() => {
    const desktopApi = getAppDesktopApi()
    if (viewerFullscreenOpen) {
      if (desktopApi?.set_fullscreen) {
        desktopApi.set_fullscreen(true).catch((error) => {
          console.error(t("전체화면 모드 진입 실패:"), error)
        })
        return
      }
      document.documentElement.requestFullscreen?.().catch((error) => {
        console.error(t("전체화면 모드 진입 실패:"), error)
      })
      return
    }
    if (desktopApi?.set_fullscreen) {
      desktopApi.set_fullscreen(false).catch((error) => {
        console.error(t("전체화면 모드 해제 실패:"), error)
      })
      return
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch((error) => {
        console.error(t("전체화면 모드 해제 실패:"), error)
      })
    }
  }, [viewerFullscreenOpen])

  return {
    annotation: {
      ...annotationWorkflows,
      palette: {
        containerRef: annotationPaletteRef,
        open: annotationPaletteOpen,
        setOpen: setAnnotationPaletteOpen,
      },
    },
    controller,
    floatingWindow,
    fullscreen: {
      open: viewerFullscreenOpen,
      setOpen: setViewerFullscreenOpen,
    },
    practice: {
      bindOpen: controller.study.setOpenPracticeForProblem,
    },
  }
}

export type PdfCoreWorkspace = ReturnType<typeof usePdfCoreWorkspace>
