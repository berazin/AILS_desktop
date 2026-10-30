import { startTransition, useCallback, useEffect, useMemo, type RefObject } from "react"
import { waitForInitialDocument } from '../../../lib/initial-document-readiness.ts'

import {
  getPdfDocumentMetas,
  getPdfStudyDocumentInfo,
  savePdfPageState,
  sendPdfStudyActivity,
  startPdfStudySession,
  togglePdfBookmark,
} from "../../../lib/api"
import { PDF_PAGE_STORAGE_KEY, readSavedPdfPages } from "../lib/pdf-page-state.ts"
import type { PdfController } from "./use-pdf-controller.ts"
import { normalizedMaterialPath } from "../../../lib/material-navigation.ts"

const PDF_STUDY_HEARTBEAT_MS = 30_000
const PDF_STUDY_IDLE_ALLOWANCE_MS = 30 * 60_000

type UsePdfStudyDocumentWorkflowsOptions = {
  configuration: { savedStudyRoot: string }
  pdf: PdfController
  document: {
    activePath: string
    currentPage: number
    latestPageRef: RefObject<number>
    openMaterialFile: (path: string) => Promise<unknown> | void
    visiblePages: number[]
  }
}

export function usePdfStudyDocumentWorkflows({
  configuration: { savedStudyRoot },
  pdf,
  document,
}: UsePdfStudyDocumentWorkflowsOptions) {
  const {
    document: { setPdfPageByDocument },
    study: {
      activePdfBookmarksPathRef, pdfBookmarks, pdfDocumentMetas, setPdfBookmarks,
      setPdfDocumentMetas,
    },
  } = pdf
  const {
    activePath,
    currentPage,
    latestPageRef,
    openMaterialFile,
    visiblePages,
  } = document

  useEffect(() => {
    activePdfBookmarksPathRef.current = activePath
    setPdfBookmarks([])
    if (!activePath || !savedStudyRoot) return undefined
    const controller = new AbortController()
    void waitForInitialDocument(controller.signal).then(() => getPdfStudyDocumentInfo(activePath, controller.signal)).then((info) => {
      if (controller.signal.aborted || activePdfBookmarksPathRef.current !== activePath) return
      setPdfBookmarks(info.bookmarks)
    }).catch((error) => {
      if (!controller.signal.aborted) console.warn("[PDF bookmarks] load failed", error)
    })
    return () => controller.abort()
  }, [activePath, savedStudyRoot, activePdfBookmarksPathRef, setPdfBookmarks])

  const refreshPdfDocumentMetas = useCallback(async (signal?: AbortSignal) => {
    if (!savedStudyRoot) {
      setPdfDocumentMetas([])
      return
    }
    try {
      const result = await getPdfDocumentMetas(signal)
      if (!signal?.aborted) setPdfDocumentMetas(result.metas)
    } catch (error) {
      if (!signal?.aborted) console.warn("[PDF document metas] load failed", error)
    }
  }, [savedStudyRoot, setPdfDocumentMetas])

  useEffect(() => {
    const controller = new AbortController()
    void waitForInitialDocument(controller.signal).then(() => refreshPdfDocumentMetas(controller.signal)).catch(() => {})
    return () => controller.abort()
  }, [refreshPdfDocumentMetas])

  const documentTagsByPath = useMemo(() => {
    const tagsByPath: Record<string, string[]> = {}
    for (const meta of pdfDocumentMetas) {
      if (meta.path && meta.tags.length > 0) tagsByPath[normalizedMaterialPath(meta.path)] = meta.tags
    }
    return tagsByPath
  }, [pdfDocumentMetas])

  useEffect(() => {
    if (!activePath || !savedStudyRoot) return undefined
    let sessionId = ""
    let disposed = false
    const controller = new AbortController()
    let lastInteractionAt = Date.now()
    let lastBeatAt = Date.now()
    const markInteraction = () => {
      lastInteractionAt = Date.now()
    }
    window.addEventListener("pointerdown", markInteraction, { passive: true })
    window.addEventListener("keydown", markInteraction)
    window.addEventListener("wheel", markInteraction, { passive: true })
    window.addEventListener("touchstart", markInteraction, { passive: true })
    void waitForInitialDocument(controller.signal).then(() => startPdfStudySession(activePath, controller.signal)).then((result) => {
      if (disposed) return
      sessionId = result.session.session_id
    }).catch((error) => {
      if (!controller.signal.aborted) console.warn("[PDF study] session start failed", error)
    })
    const heartbeat = window.setInterval(() => {
      if (!sessionId || disposed) return
      const now = Date.now()
      const elapsedSeconds = Math.min((now - lastBeatAt) / 1000, 120)
      lastBeatAt = now
      const visible = window.document.visibilityState === "visible"
      const idleWithinAllowance = now - lastInteractionAt <= PDF_STUDY_IDLE_ALLOWANCE_MS
      if (!visible || !idleWithinAllowance || elapsedSeconds < 1) return
      void sendPdfStudyActivity(sessionId, Math.round(elapsedSeconds), latestPageRef.current || undefined, controller.signal).catch(() => {})
    }, PDF_STUDY_HEARTBEAT_MS)
    return () => {
      disposed = true
      controller.abort()
      window.clearInterval(heartbeat)
      window.removeEventListener("pointerdown", markInteraction)
      window.removeEventListener("keydown", markInteraction)
      window.removeEventListener("wheel", markInteraction)
      window.removeEventListener("touchstart", markInteraction)
    }
  }, [activePath, savedStudyRoot, latestPageRef])

  const pdfCurrentPageBookmarked = pdfBookmarks.some((bookmark) => visiblePages.includes(bookmark.page))

  function toggleCurrentPdfBookmark() {
    bookmarkPageWithLabel(latestPageRef.current || currentPage, "")
  }

  // 북마크 다이얼로그용: 페이지를 지정해 이름(label)과 함께 저장하거나, 이미 있으면 제거한다.
  function bookmarkPageWithLabel(page: number, label: string) {
    const pdfPath = activePath
    if (!pdfPath) return
    void togglePdfBookmark(pdfPath, page, label).then((result) => {
      if (activePdfBookmarksPathRef.current === pdfPath) setPdfBookmarks(result.bookmarks)
    }).catch((error) => {
      console.warn("[PDF bookmarks] toggle failed", error)
    })
  }

  function handleOpenMaterialAtPage(filePath: string, page: number) {
    const pathKey = normalizedMaterialPath(filePath)
    const nextPage = Math.max(1, Math.floor(Number(page) || 1))
    if (pathKey) {
      const pages = readSavedPdfPages()
      pages[pathKey] = nextPage
      localStorage.setItem(PDF_PAGE_STORAGE_KEY, JSON.stringify(pages))
      startTransition(() => {
        setPdfPageByDocument((current) => ({ ...current, [pathKey]: nextPage }))
      })
      void savePdfPageState({ path: pathKey, page: nextPage }).catch((error) => {
        console.warn("[PDF page state] save failed", error)
      })
    }
    void openMaterialFile(filePath)
  }

  return {
    bookmarkPageWithLabel,
    documentTagsByPath,
    handleOpenMaterialAtPage,
    pdfBookmarks,
    pdfCurrentPageBookmarked,
    refreshPdfDocumentMetas,
    toggleCurrentPdfBookmark,
  }
}
