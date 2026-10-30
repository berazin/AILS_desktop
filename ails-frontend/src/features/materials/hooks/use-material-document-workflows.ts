import { documentAllowed, IDE_DISABLED_MESSAGE } from "../../../lib/ide-policy.ts"
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { getOfficeSession } from '../../office/session.ts'

import type { DashboardRecentFile } from "../../../shared/workspace-types.ts"
import {
  getMaterialFileTextStatus,
  getLibreOfficeStatus,
  getPresentationConvertStatus,
  installLibreOffice,
  unlockMaterialPdf,
  type AILSReport,
  type MaterialFilePayload,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { readSavedPdfPages } from "../../pdf/lib/pdf-page-state.ts"
import {
  isPdfPasswordError,
  inferPdfPageCount,
  pdfPageStorageKey,
  savedPdfPageForDocument,
  titleFromPath,
  viewerFromMaterial,
  type ViewerDocument,
} from "../../../lib/viewer-document.ts"
import type { InteractionRunner } from "../../code-sandbox/hooks/use-interaction-runner.ts"
import type { MaterialsController } from "./use-materials-controller.ts"
import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { createPresentationOpenGuard } from "../lib/presentation-open-guard.ts"

const MAX_RECENT_FILES = 20

export type PresentationOpenProgress = {
  path: string
  stage: "preparing" | "converting" | "finalizing"
  elapsedSeconds: number
  error: string
}

function isPresentationPath(filePath: string) {
  return /\.pptx?$/i.test(filePath.trim())
}

type UseMaterialDocumentWorkflowsOptions = {
  documents: {
    items: ViewerDocument[]
    selectedId: string
    homeTabId?: string
    replaceHomeTab?: (tabId: string, documentId: string) => void
    restoreHomeTab?: (tabId: string, pendingId: string) => void
    replaceTabId?: (previousId: string, documentId: string) => void
    onDocumentReplaced?: (previousId: string, document: ViewerDocument) => void
    setDocuments: Dispatch<SetStateAction<ViewerDocument[]>>
    setSelectedDocumentId: Dispatch<SetStateAction<string>>
    setSelectedReport: Dispatch<SetStateAction<AILSReport | null>>
    setSelectedReportId: Dispatch<SetStateAction<string>>
    setWorkspaceSurface: Dispatch<SetStateAction<WorkspaceSurface>>
    viewerDocument: ViewerDocument | null
  }
  loadFile: MaterialsController["actions"]["loadFile"]
  pdf: {
    document: Pick<PdfController["document"],
      "libreOfficeInstallError" | "pendingLibreOfficeFilePath" | "pendingPdfPasswordPath" | "pdfPasswordDraft"
      | "setLibreOfficeInstallError" | "setPdfPageByDocument" | "setPdfPasswordDraft" | "setPdfPasswordError"
      | "setPendingLibreOfficeFilePath" | "setPendingPdfPasswordPath">
    ocr: Pick<PdfController["ocr"], "pdfTextExtractionAbortRef" | "pdfSettingsLoadAbortRef">
    study: Pick<PdfController["study"], "pdfProblemsLoadAbortRef" | "pdfProblemAnalysisAbortRef">
  }
  recentFiles: {
    set: Dispatch<SetStateAction<DashboardRecentFile[]>>
  }
  runInteraction: InteractionRunner["runInteraction"]
  setNotice: (notice: string) => void
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError"
}

export function useMaterialDocumentWorkflows({
  documents,
  loadFile,
  pdf,
  recentFiles,
  runInteraction,
  setNotice,
}: UseMaterialDocumentWorkflowsOptions) {
  const openAbortRef = useRef<AbortController | null>(null)
  const openNewTabRef = useRef(false)
  const openRequestIdRef = useRef(0)
  const replacedDocumentsRef = useRef(new Map<string, ViewerDocument>())
  const passwordNewTabRef = useRef(false)
  const passwordHomeTabRef = useRef<string | undefined>(undefined)
  const presentationNewTabRef = useRef(false)
  const presentationHomeTabRef = useRef<string | undefined>(undefined)
  const [linkedMarkdownWindow, setLinkedMarkdownWindow] = useState<ViewerDocument | null>(null)
  const [presentationOpenProgress, setPresentationOpenProgress] = useState<PresentationOpenProgress | null>(null)
  const { setDocuments, viewerDocument } = documents
  const { pdfTextExtractionAbortRef } = pdf.ocr
  const {
    libreOfficeInstallError,
    pendingLibreOfficeFilePath,
    pendingPdfPasswordPath,
    pdfPasswordDraft,
    setLibreOfficeInstallError,
    setPdfPageByDocument,
    setPdfPasswordDraft,
    setPdfPasswordError,
    setPendingLibreOfficeFilePath,
    setPendingPdfPasswordPath,
  } = pdf.document

  const applySavedPdfPage = useEventCallback((document: ViewerDocument) => {
    const savedPage = savedPdfPageForDocument(document, readSavedPdfPages())
    if (!savedPage) return
    const pathKey = pdfPageStorageKey(document)
    setPdfPageByDocument((current) => ({
      ...current,
      [document.id]: savedPage,
      ...(pathKey ? { [pathKey]: savedPage } : {}),
    }))
  })

  const applySavedFileState = useEventCallback((file: MaterialFilePayload, target: ViewerDocument | null = documents.viewerDocument) => {
    const nextDocument = viewerFromMaterial(file)
    applySavedPdfPage(nextDocument)
    if (target?.source === "material") {
      documents.setDocuments((current) =>
        current.map((document) => (document.id === target.id ? { ...nextDocument, id: target.id } : document)),
      )
    } else {
      documents.setSelectedReport((current) => current && current.file_path === target?.file_path
        ? {
            ...current,
            content: file.content,
            raw_content: file.raw_content,
            file_path: file.file_path,
            title: file.title,
          }
        : current)
    }
  })

  const selectDocument = useEventCallback((id: string) => {
    documents.setSelectedDocumentId(id)
    documents.setSelectedReportId("")
    documents.setWorkspaceSurface("document")
  })

  const showDocument = useEventCallback((document: ViewerDocument, newTab = false, homeTabId: string | undefined = documents.homeTabId) => {
    if (!document.loading) applySavedPdfPage(document)
    documents.setDocuments((current) => {
      if (current.some((item) => item.id === document.id)) {
        return current.map((item) => item.id === document.id ? document : item)
      }
      const activeIndex = current.findIndex((item) => item.id === documents.selectedId)
      if (newTab || homeTabId || activeIndex < 0) return [...current, document]
      return current.map((item, index) => index === activeIndex ? document : item)
    })
    if (!newTab && homeTabId) documents.replaceHomeTab?.(homeTabId, document.id)
    else documents.replaceTabId?.(newTab || documents.items.some((item) => item.id === document.id) ? "" : documents.selectedId, document.id)
    if (!newTab && !homeTabId) documents.onDocumentReplaced?.(documents.selectedId, document)
    selectDocument(document.id)
  })

  const openMaterialFile = useEventCallback(async (filePath: string, options?: { newTab?: boolean; homeTabId?: string; reload?: boolean }) => {
    if (!documentAllowed(filePath)) { setNotice(IDE_DISABLED_MESSAGE); return }
    // Keep unsaved office documents resident when navigating to another file.
    if (getOfficeSession(documents.selectedId)?.dirty && !options?.newTab) options = { ...options, newTab: true }
    const homeTabId = options?.newTab ? undefined : options?.homeTabId ?? documents.homeTabId
    const requestId = openRequestIdRef.current + 1
    openRequestIdRef.current = requestId
    const existing = documents.items.find((item) =>
      item.file_path.replace(/\\/g, "/").toLowerCase() === filePath.replace(/\\/g, "/").toLowerCase(),
    )
    // Each loading tab owns its request, including repeated clicks on that tab.
    // A different in-place open still supersedes the previous in-place request.
    if (!options?.newTab && !openNewTabRef.current && !existing?.loading) openAbortRef.current?.abort()
    if (existing && !options?.reload) {
      if (homeTabId) documents.replaceHomeTab?.(homeTabId, existing.id)
      if (!options?.newTab && !homeTabId) documents.onDocumentReplaced?.(documents.selectedId, existing)
      selectDocument(existing.id)
      return
    }
    pdf.ocr.pdfSettingsLoadAbortRef.current?.abort()
    pdf.study.pdfProblemsLoadAbortRef.current?.abort()
    pdf.study.pdfProblemAnalysisAbortRef.current?.abort()
    pdf.ocr.pdfTextExtractionAbortRef.current?.abort()
    const controller = new AbortController()
    openAbortRef.current = controller
    openNewTabRef.current = Boolean(options?.newTab || homeTabId)
    const previousId = documents.selectedId
    const previous = !options?.newTab && !homeTabId ? documents.items.find(item => item.id === previousId) : undefined
    const replaced = previous ? replacedDocumentsRef.current.get(previous.id) ?? previous : undefined
    const pending: ViewerDocument | null = !options?.reload ? {
      id: `opening:${requestId}:${filePath}`,
      title: titleFromPath(filePath),
      // Do not initialize a PDF/notebook with incomplete metadata.
      kind: "txt",
      content: "",
      file_path: filePath,
      source: "material",
      read_only: true,
      loading: true,
    } : null
    if (pending) {
      if (replaced) replacedDocumentsRef.current.set(pending.id, replaced)
      if (homeTabId) documents.replaceHomeTab?.(homeTabId, pending.id)
      showDocument(pending, Boolean(options?.newTab || homeTabId))
    }
    let convertPollTimer: number | undefined
    const presentationGuard = isPresentationPath(filePath)
      ? createPresentationOpenGuard(controller, t("PPT/PPTX 열기 시간이 초과되었습니다. 다시 열어 주세요."))
      : null
    if (isPresentationPath(filePath)) {
      // LibreOffice 변환은 수십 초 걸릴 수 있어서 열기 요청 동안 진행 상태를 폴링한다.
      const pollStartedAt = Date.now()
      setPresentationOpenProgress({ path: filePath, stage: "preparing", elapsedSeconds: 0, error: "" })
      const pollConvertStatus = async () => {
        try {
          const status = await getPresentationConvertStatus(filePath, controller.signal)
          if (openAbortRef.current !== controller) return
          presentationGuard?.observe(status)
          setPresentationOpenProgress({
            path: filePath,
            stage: status.active ? "converting" : status.cache_ready ? "finalizing" : "preparing",
            elapsedSeconds: status.active
              ? Math.max(1, Math.round(status.elapsed_seconds))
              : Math.round((Date.now() - pollStartedAt) / 1000),
            error: status.error,
          })
        } catch {
          // 상태 조회 실패는 열기 요청을 막지 않는다.
        }
      }
      void pollConvertStatus()
      convertPollTimer = window.setInterval(() => void pollConvertStatus(), 1000)
    }
    try {
      await runInteraction(`material-file-${filePath}`, t("강의자료 파일 열기"), async () => {
        let file: MaterialFilePayload
        try {
          const read = loadFile(filePath, controller.signal)
          const response = await (presentationGuard?.wait(read) ?? read)
          if (controller.signal.aborted || (!pending && openRequestIdRef.current !== requestId)) {
            throw new DOMException("Superseded PDF open request", "AbortError")
          }
          file = response.file
        } catch (error) {
          if (presentationGuard?.error()) throw presentationGuard.error()
          if (controller.signal.aborted || (!pending && openRequestIdRef.current !== requestId) || isAbortError(error)) {
            throw new DOMException("Superseded PDF open request", "AbortError")
          }
          recentFiles.set((current) => {
            const updated = current.filter((item) => item.path !== filePath)
            localStorage.setItem("ails-recent-files", JSON.stringify(updated))
            return updated
          })
          if (isPdfPasswordError(error)) {
            passwordNewTabRef.current = Boolean(options?.newTab)
            passwordHomeTabRef.current = homeTabId
            setPendingPdfPasswordPath(filePath)
            setPdfPasswordDraft("")
            setPdfPasswordError("")
            return t("비밀번호가 필요한 PDF입니다.")
          }
          throw error
        }
        if (["ppt", "pptx"].includes(file.kind) && file.requires_libreoffice) {
          presentationNewTabRef.current = Boolean(options?.newTab)
          presentationHomeTabRef.current = homeTabId
          setPendingLibreOfficeFilePath(filePath)
          setLibreOfficeInstallError("")
          return t("PPT/PPTX 렌더링에는 LibreOffice가 필요합니다.")
        }
        const document = viewerFromMaterial(file)
        if (options?.reload && existing) {
          // Refresh only its target; a late response cannot reselect or revive a tab.
          applySavedFileState(file, existing)
        } else if (pending) {
          applySavedPdfPage(document)
          documents.setDocuments((current) => {
            if (!current.some((item) => item.id === pending.id)) return current
            documents.replaceTabId?.(pending.id, document.id)
            if (!options?.newTab && !homeTabId) documents.onDocumentReplaced?.(pending.id, document)
            const alreadyOpen = current.some((item) => item.id === document.id)
            return alreadyOpen
              ? current.filter((item) => item.id !== pending.id)
              : current.map((item) => item.id === pending.id ? document : item)
          })
          // A late response must not select a tab the user switched away from.
          documents.setSelectedDocumentId((current) => current === pending.id ? document.id : current)
        } else {
          showDocument(document)
        }
        recentFiles.set((current) => {
          const filtered = current.filter((item) => item.path !== filePath)
          const updated = [
            {
              path: filePath,
              title: document.title,
              kind: document.kind,
              lastOpenedAt: new Date().toISOString(),
              pageCount: document.kind === "pdf" || document.rendered_file_path ? inferPdfPageCount(document) : undefined,
            },
            ...filtered,
          ].slice(0, MAX_RECENT_FILES)
          localStorage.setItem("ails-recent-files", JSON.stringify(updated))
          return updated
        })
        return t("강의자료 리포트를 열었습니다: {p0}", { p0: document.title })
      })
    } finally {
      if (pending) {
        documents.setDocuments((current) => {
          if (!current.some((item) => item.id === pending.id)) return current
          if (homeTabId) documents.restoreHomeTab?.(homeTabId, pending.id)
          const alreadyOpen = replaced && current.some(item => item.id === replaced.id)
          const remaining = replaced && !alreadyOpen
            ? current.map(item => item.id === pending.id ? replaced : item)
            : current.filter((item) => item.id !== pending.id)
          if (replaced) {
            documents.replaceTabId?.(pending.id, replaced.id)
            documents.onDocumentReplaced?.(pending.id, replaced)
          }
          const fallback = replaced?.id ?? remaining.find((item) => item.id === previousId)?.id ?? remaining.at(-1)?.id ?? ""
          if (!homeTabId) documents.setSelectedDocumentId((selected) => selected === pending.id ? fallback : selected)
          return remaining
        })
        replacedDocumentsRef.current.delete(pending.id)
      }
      if (convertPollTimer !== undefined) window.clearInterval(convertPollTimer)
      presentationGuard?.dispose()
      setPresentationOpenProgress((current) => (current?.path === filePath ? null : current))
      if (openAbortRef.current === controller) openAbortRef.current = null
    }
  })

  // Ctrl+클릭·휠 클릭용 백그라운드 열기: 탭에는 추가하되 현재 문서 선택을 바꾸지 않는다.
  const openMaterialFileInBackground = useEventCallback(async (filePath: string) => {
    if (!documentAllowed(filePath)) { setNotice(IDE_DISABLED_MESSAGE); return }
    if (documents.items.some((item) => item.file_path.replace(/\\/g, "/").toLowerCase() === filePath.replace(/\\/g, "/").toLowerCase())) return
    try {
      const { file } = await loadFile(filePath)
      const document = viewerFromMaterial(file)
      applySavedPdfPage(document)
      documents.setDocuments((current) =>
        current.some((item) => item.id === document.id) ? current : [...current, document],
      )
      documents.replaceTabId?.("", document.id)
    } catch (error) {
      setNotice(t("새 탭으로 열지 못했습니다: {p0}", { p0: getErrorMessage(error) }))
    }
  })

  useEffect(() => {
    const filePath = viewerDocument?.file_path
    const extractionStatus = viewerDocument?.text_extraction_status
    if (
      !filePath
      || viewerDocument?.kind !== "pdf"
      || (extractionStatus !== "pending" && extractionStatus !== "extracting")
    ) {
      return
    }

    let cancelled = false
    const controller = new AbortController()
    pdfTextExtractionAbortRef.current?.abort()
    pdfTextExtractionAbortRef.current = controller
    let timerId: number | undefined
    let failedAttempts = 0

    const schedulePoll = (delay: number) => {
      timerId = window.setTimeout(poll, delay)
    }

    const poll = async () => {
      try {
        const result = await getMaterialFileTextStatus(filePath, controller.signal)
        if (cancelled) return
        failedAttempts = 0
        setDocuments((current) => current.map((document) => {
          if (document.file_path !== filePath) return document
          return {
            ...document,
            content: result.status === "ready" ? result.content ?? "" : document.content,
            page_count: result.page_count ?? document.page_count,
            page_texts: result.status === "ready" ? result.page_texts ?? [] : document.page_texts,
            text_extraction_status: result.status,
            text_extraction_cached: result.cached,
            text_extraction_error: result.error ?? "",
          }
        }))
        if (result.status === "pending" || result.status === "extracting") schedulePoll(1000)
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error) || cancelled) return
        failedAttempts += 1
        if (failedAttempts <= 5) {
          schedulePoll(1500)
        } else {
          console.warn("[PDF text extraction] status polling failed", error)
        }
      }
    }

    schedulePoll(500)
    return () => {
      cancelled = true
      controller.abort()
      if (pdfTextExtractionAbortRef.current === controller) {
        pdfTextExtractionAbortRef.current = null
      }
      if (timerId !== undefined) window.clearTimeout(timerId)
    }
  }, [
    pdfTextExtractionAbortRef,
    setDocuments,
    viewerDocument?.file_path,
    viewerDocument?.kind,
    viewerDocument?.text_extraction_status,
  ])

  useEffect(() => {
    try {
      const openMaterial = new URLSearchParams(window.location.search).get("openMaterial")
      if (openMaterial) void openMaterialFile(openMaterial)
    } catch {
      void 0
    }
  }, [openMaterialFile])

  const installLibreOfficeAndReopenPresentation = useEventCallback(async () => {
    const path = pendingLibreOfficeFilePath
    if (!path) return
    await runInteraction("libreoffice-install", t("LibreOffice 설치"), async () => {
      try {
        const status = await getLibreOfficeStatus()
        if (!status.installed && !status.install_supported) {
          setLibreOfficeInstallError(t("이 PC에서는 winget을 찾을 수 없어 자동 설치할 수 없습니다."))
          return t("LibreOffice 자동 설치를 사용할 수 없습니다.")
        }
        if (!status.installed) await installLibreOffice()
        setPendingLibreOfficeFilePath("")
        setLibreOfficeInstallError("")
        await openMaterialFile(path, { newTab: presentationNewTabRef.current, homeTabId: presentationHomeTabRef.current })
        return t("LibreOffice 설치를 확인했고 PPT/PPTX를 다시 열었습니다.")
      } catch (error) {
        const message = getErrorMessage(error)
        setLibreOfficeInstallError(message)
        return t("LibreOffice 설치 실패: {p0}", { p0: message })
      }
    })
  })

  const submitPdfPassword = useEventCallback(async () => {
    const path = pendingPdfPasswordPath
    const password = pdfPasswordDraft
    if (!path) return
    if (!password) {
      setPdfPasswordError(t("비밀번호를 입력하세요."))
      return
    }
    await runInteraction(`pdf-unlock-${path}`, t("PDF 잠금 해제"), async () => {
      try {
        const { file } = await unlockMaterialPdf({ path, password })
        const document = viewerFromMaterial(file)
        showDocument(document, passwordNewTabRef.current, passwordHomeTabRef.current)
        setPendingPdfPasswordPath("")
        setPdfPasswordDraft("")
        setPdfPasswordError("")
        return t("PDF 잠금을 해제했습니다. 앞으로 비밀번호 없이 열립니다.")
      } catch (error) {
        if (isPdfPasswordError(error)) {
          setPdfPasswordError(t("비밀번호가 올바르지 않습니다."))
          return t("PDF 비밀번호가 올바르지 않습니다.")
        }
        throw error
      }
    })
  })
  const openLinkedMarkdown = useEventCallback(async (href: string) => {
    await runInteraction(`linked-md-${href}`, t("링크 정리본 열기"), async () => {
      const path = new URL(href, window.location.origin).searchParams.get("path")
      if (!path) throw new Error(t("열 수 있는 로컬 MD 경로가 없습니다."))
      const { file } = await loadFile(path)
      const document = viewerFromMaterial(file)
      applySavedPdfPage(document)
      setLinkedMarkdownWindow(document)
      return t("링크 정리본을 열었습니다: {p0}", { p0: document.title })
    })
  })
  const openLinkedMarkdownInViewer = useEventCallback(() => {
    if (!linkedMarkdownWindow) return
    showDocument(linkedMarkdownWindow)
    setLinkedMarkdownWindow(null)
    setNotice(t("정리본을 뷰어에 열었습니다: {p0}", { p0: linkedMarkdownWindow.title }))
  })
  const cancelOpen = useEventCallback(() => openAbortRef.current?.abort())
  const closeLinkedMarkdown = useEventCallback(() => setLinkedMarkdownWindow(null))

  return {
    showDocument,
    applySavedFileState,
    applySavedPdfPage,
    cancelOpen,
    installLibreOfficeAndReopenPresentation,
    libreOfficeInstallError,
    linkedMarkdownWindow,
    closeLinkedMarkdown,
    openLinkedMarkdown,
    openLinkedMarkdownInViewer,
    openMaterialFile,
    openMaterialFileInBackground,
    presentationOpenProgress,
    submitPdfPassword,
  }
}

export type MaterialDocumentWorkflows = ReturnType<typeof useMaterialDocumentWorkflows>
