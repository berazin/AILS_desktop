import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { getPdfOcrStatus, getPdfStudyDocumentInfo, savePdfDocumentNote, savePdfDocumentTags,
  type PdfOcrStatus, type PdfStudyDocumentInfo } from "../../../lib/api"
import { pdfChapterForPage } from "../../../lib/pdf-outline.ts"
import { documentReadingPosition } from "../lib/document-detail-presentation.ts"
import type { MaterialItem } from "./use-materials-listing.ts"

function message(error: unknown) { return error instanceof Error ? error.message : String(error) }

export function useDocumentDetail(detailedModalItem: MaterialItem, onDocumentMetaChanged?: () => void, hasActiveOcrJob = false) {
  const [modalStudyInfo, setModalStudyInfo] = useState<PdfStudyDocumentInfo | null>(null)
  const [ocrStatus, setOcrStatus] = useState<PdfOcrStatus | null>(null)
  const [studyLoading, setStudyLoading] = useState(detailedModalItem.kind === "PDF")
  const [ocrLoading, setOcrLoading] = useState(detailedModalItem.kind === "PDF")
  const [studyError, setStudyError] = useState("")
  const [ocrError, setOcrError] = useState("")
  const [saveError, setSaveError] = useState("")
  const [modalNoteDraft, setModalNoteDraft] = useState("")
  const [modalNoteSaving, setModalNoteSaving] = useState(false)
  const [modalNoteSaved, setModalNoteSaved] = useState(false)
  const [modalTagDraft, setModalTagDraft] = useState("")
  const [modalTagsSaving, setModalTagsSaving] = useState(false)
  const pathRef = useRef(detailedModalItem.path)
  const ocrRequestVersion = useRef(0)
  const previousOcrJob = useRef({ path: detailedModalItem.path, active: hasActiveOcrJob })
  useLayoutEffect(() => {
    pathRef.current = detailedModalItem.path
    return () => { pathRef.current = "" }
  }, [detailedModalItem.path])

  const loadOcrStatus = useCallback((path: string, signal: AbortSignal) => {
    const version = ++ocrRequestVersion.current
    const current = () => !signal.aborted && pathRef.current === path && ocrRequestVersion.current === version
    setOcrLoading(true); setOcrError("")
    void getPdfOcrStatus(path, signal).then(status => {
      if (current()) setOcrStatus(status)
    }).catch(error => { if (current()) setOcrError(message(error)) })
      .finally(() => { if (current()) setOcrLoading(false) })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setModalStudyInfo(null); setOcrStatus(null)
    setStudyError(""); setOcrError(""); setSaveError("")
    setModalNoteDraft(""); setModalNoteSaved(false); setModalTagDraft("")
    setModalNoteSaving(false); setModalTagsSaving(false)
    const isPdf = detailedModalItem.kind === "PDF"
    setStudyLoading(isPdf); setOcrLoading(isPdf)
    if (isPdf) {
      void getPdfStudyDocumentInfo(detailedModalItem.path, controller.signal).then(info => {
        if (!controller.signal.aborted) { setModalStudyInfo(info); setModalNoteDraft(info.note) }
      }).catch(error => { if (!controller.signal.aborted) setStudyError(message(error)) })
        .finally(() => { if (!controller.signal.aborted) setStudyLoading(false) })
      loadOcrStatus(detailedModalItem.path, controller.signal)
    }
    return () => controller.abort()
  }, [detailedModalItem.path, detailedModalItem.kind, loadOcrStatus])

  useEffect(() => {
    const previous = previousOcrJob.current
    previousOcrJob.current = { path: detailedModalItem.path, active: hasActiveOcrJob }
    if (detailedModalItem.kind !== "PDF" || previous.path !== detailedModalItem.path || !previous.active || hasActiveOcrJob) return
    const controller = new AbortController()
    loadOcrStatus(detailedModalItem.path, controller.signal)
    return () => controller.abort()
  }, [detailedModalItem.path, detailedModalItem.kind, hasActiveOcrJob, loadOcrStatus])

  const modalOutline = useMemo(() => ocrStatus?.outline ?? [], [ocrStatus])
  const modalPdfPageCount = ocrStatus?.page_count || detailedModalItem.totalPages || 0
  const position = documentReadingPosition(detailedModalItem, modalPdfPageCount, modalStudyInfo?.study.session_count)
  const modalCurrentChapter = useMemo(() => detailedModalItem.kind === "PDF" && position.page !== null && modalOutline.length
    ? pdfChapterForPage(modalOutline, modalPdfPageCount || 1, detailedModalItem.lastPage || 1) : null,
  [detailedModalItem.kind, detailedModalItem.lastPage, modalOutline, modalPdfPageCount, position.page])

  async function saveModalNote() {
    if (!modalStudyInfo || modalNoteSaving) return
    const path = detailedModalItem.path
    setModalNoteSaving(true); setModalNoteSaved(false); setSaveError("")
    try {
      await savePdfDocumentNote(detailedModalItem.path, modalNoteDraft)
      if (pathRef.current === path) { setModalNoteSaved(true); onDocumentMetaChanged?.() }
    } catch (error) { if (pathRef.current === path) setSaveError(message(error)) }
    finally { if (pathRef.current === path) setModalNoteSaving(false) }
  }

  async function saveModalTags(nextTags: string[]) {
    if (!modalStudyInfo || modalTagsSaving) return false
    const path = detailedModalItem.path
    setModalTagsSaving(true); setSaveError("")
    try {
      const result = await savePdfDocumentTags(detailedModalItem.path, nextTags)
      if (pathRef.current === path) {
        setModalStudyInfo(current => current ? { ...current, tags: result.tags } : current)
        onDocumentMetaChanged?.()
      }
      return true
    } catch (error) { if (pathRef.current === path) setSaveError(message(error)); return false }
    finally { if (pathRef.current === path) setModalTagsSaving(false) }
  }

  function addModalTag() {
    const tag = modalTagDraft.trim()
    if (!tag || !modalStudyInfo || modalTagsSaving) return
    if (modalStudyInfo.tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) { setModalTagDraft(""); return }
    void saveModalTags([...modalStudyInfo.tags, tag]).then(saved => { if (saved && pathRef.current === detailedModalItem.path) setModalTagDraft("") })
  }

  return { modalStudyInfo, ocrStatus, studyLoading, ocrLoading, studyError, ocrError, saveError,
    modalNoteDraft, setModalNoteDraft, modalNoteSaving, modalNoteSaved, setModalNoteSaved, saveModalNote,
    modalTagDraft, setModalTagDraft, modalTagsSaving, addModalTag, saveModalTags,
    modalOutline, modalPdfPageCount, modalCurrentChapter, position }
}

export type DocumentDetailController = ReturnType<typeof useDocumentDetail>
