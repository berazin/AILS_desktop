import type { KeyboardEvent, RefObject } from "react"
import { useCallback, useEffect, useRef, useState } from "react"

import type { MaterialFilePayload, MaterialImageLinkUpdate } from "../../../lib/api"
import type { saveMaterialFile } from "../../../lib/api"
import { DocumentSaveQueue } from "../lib/document-save-queue.ts"
import { t } from "../../../lib/i18n.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { projectMarkdownImages, removeImageFromMarkdown, type MarkdownImagePreview } from "../lib/markdown-image-preview.ts"
import { rewriteMovedImageSources } from "../lib/moved-image-links.ts"
import type { DocumentEditTransfer } from "../../../shared/workspace-tab-transfer.ts"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"

type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
  onError?: (error: unknown) => void,
  options?: { replace?: boolean },
) => Promise<void>

type UseViewerEditingWorkflowOptions = {
  document: ViewerDocument | null
  interaction: {
    runInteraction: RunInteraction
    setNotice: (notice: string) => void
  }
  persistence: {
    save: typeof saveMaterialFile
    applySavedFile: (file: MaterialFilePayload, target?: ViewerDocument) => void
    refreshMaterials: () => Promise<unknown>
  }
  scroll: {
    fullscreen: boolean
    getFullscreenContainer: () => HTMLElement | null
    getPrimaryContainer: () => HTMLElement | null
  }
}

export type ViewerMarkdownEditorModel = {
  content: string
  onChange: (content: string) => void
  onKeyDown: (event: KeyboardEvent) => void
  redoCount: number
  textareaRef: RefObject<HTMLTextAreaElement | null>
  beforeModeChangeRef: RefObject<((next:boolean) => void) | null>
  undoCount: number
  imagePreview?: MarkdownImagePreview
}

export function useViewerEditingWorkflow({
  document,
  interaction,
  persistence,
  scroll,
}: UseViewerEditingWorkflowOptions) {
  const [editMode, setEditMode] = useState(false)
  const [previewPending, setPreviewPending] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const [draftContent, setDraftContent] = useState("")
  const [editDocumentId, setEditDocumentId] = useState("")
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const [imagePreview, setImagePreview] = useState<MarkdownImagePreview | null>(null)
  const imageBaseRef = useRef<{ id: string; content: string; rawContent: string; sources: string[] } | null>(null)
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const beforeModeChangeRef = useRef<((next:boolean) => void) | null>(null)
  const lastLoadedFileRef = useRef("")
  const currentDocumentRef = useRef(document)
  const draftRef = useRef(draftContent)
  const [saveQueue] = useState(() => new DocumentSaveQueue())
  const transitionVersionRef = useRef(0)
  const saveVersionRef = useRef(0)
  const saveBeforeCloseRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => { currentDocumentRef.current = document; draftRef.current = draftContent }, [document, draftContent])
  useEffect(() => getAppDesktopApi()?.on_before_close?.(async () => {
    await saveBeforeCloseRef.current()
    // Showing an optimistic edit must not let app shutdown discard its save.
    await saveQueue.waitForIdle()
  }), [saveQueue])
  const readerContent = (editMode || previewPending) && editDocumentId === document?.id
    ? draftContent : document?.raw_content ?? document?.content ?? ""

  const reset = useCallback(() => {
    imageBaseRef.current = null
    setImagePreview(null)
    setEditMode(false)
    setPreviewPending(false)
    transitionVersionRef.current += 1
    setDraftContent("")
    setUndoStack([])
    setRedoStack([])
    setEditDocumentId("")
  }, [])

  useEffect(() => {
    if (!editMode && !editDocumentId) return
    if (!document?.id || document.id !== editDocumentId) reset()
  }, [document?.id, editDocumentId, editMode, reset])

  useEffect(() => {
    if (document?.id && lastLoadedFileRef.current !== document.id) {
      lastLoadedFileRef.current = document.id
      setUndoStack([])
      setRedoStack([])
    }
  }, [document?.id])

  const applySavedFile = useCallback((file: MaterialFilePayload) => {
    persistence.applySavedFile(file)
    setDraftContent(file.raw_content ?? file.content)
  }, [persistence])

  const saveDraft = useCallback(async () => {
    if (!document?.file_path || !["md", "ipynb"].includes(document.kind)) {
      interaction.setNotice(t("저장할 수 있는 MD 또는 ipynb 파일이 없습니다."))
      return false
    }
    const target = document
    const content = draftContent
    const version = ++saveVersionRef.current
    setSavePending(true)
    let saved = false
    // Serialize rapid switches so an older request cannot overwrite a newer draft on disk.
    const task = saveQueue.enqueue(async () => {
      const savedContent = saveQueue.lastSaved(target.file_path)
        ?? (currentDocumentRef.current?.id === target.id
          ? currentDocumentRef.current.raw_content ?? currentDocumentRef.current.content : undefined)
      if (savedContent === content) {
        saved = true
        return
      }
      interaction.setNotice(t("정리본 저장 중…"))
      try {
        const { file } = await persistence.save({ path: target.file_path, content })
        saveQueue.remember(target.file_path, file.raw_content ?? file.content)
        saved = true
        persistence.applySavedFile(file, target)
        if (currentDocumentRef.current?.id === target.id && saveVersionRef.current === version) {
          if (draftRef.current === content) {
            setDraftContent(file.raw_content ?? file.content)
            setPreviewPending(false)
          }
        }
        // Refreshing the library is independent of showing the saved document.
        void persistence.refreshMaterials().catch(() => {
          interaction.setNotice(t("정리본은 저장됐지만 자료 목록을 갱신하지 못했습니다."))
        })
        interaction.setNotice(t("정리본을 저장했습니다."))
      } catch (error) {
        interaction.setNotice(t("저장 실패: {p0}", { p0: error instanceof Error ? error.message : String(error) }))
      }
    })
    try { await task } finally {
      if (saveVersionRef.current === version) setSavePending(false)
    }
    return saved
  }, [document, draftContent, interaction, persistence, saveQueue])

  useEffect(() => {
    saveBeforeCloseRef.current = async () => {
      if (document?.id !== editDocumentId || (!editMode && !previewPending)) return
      if (draftRef.current === (document?.raw_content ?? document?.content)) return
      if (!await saveDraft()) throw new Error(t("문서를 저장하지 못해 창을 닫지 않았습니다. 저장 후 다시 닫아 주세요."))
    }
  }, [document, editDocumentId, editMode, previewPending, saveDraft])

  const enterEditMode = useCallback(() => {
    if (!document?.file_path || !["md", "ipynb"].includes(document.kind)) {
      interaction.setNotice(t("MD 또는 ipynb 파일만 편집할 수 있습니다."))
      return
    }
    if (document.kind === "ipynb") {
      interaction.setNotice(t("ipynb는 편집할 셀을 더블클릭하세요."))
      return
    }

    transitionVersionRef.current += 1
    setImagePreview(null)
    imageBaseRef.current = null
    beforeModeChangeRef.current?.(true)
    if (!previewPending || editDocumentId !== document.id) setDraftContent(document.raw_content ?? document.content)
    setEditDocumentId(document.id)
    setEditMode(true)
    interaction.setNotice(t("편집 모드로 전환했습니다. Tab으로 읽기 모드로 돌아가며 저장합니다."))
  }, [document, editDocumentId, previewPending, interaction])

  const leaveEditMode = useCallback(async (save = true) => {
    const version = ++transitionVersionRef.current
    const changed = draftContent !== (document?.raw_content ?? document?.content)
    beforeModeChangeRef.current?.(false)
    setPreviewPending(save && (changed || previewPending))
    setEditMode(false)
    if (save && (changed || previewPending)) {
      let saved = false
      try { saved = await saveDraft() } finally {
        if (transitionVersionRef.current === version && currentDocumentRef.current?.id === document?.id) {
          setPreviewPending(false)
          if (!saved) {beforeModeChangeRef.current?.(true); setEditMode(true)}
        }
      }
    }
  }, [document, draftContent, previewPending, saveDraft])

  const changeDraft = useCallback((nextContent: string) => {
    setUndoStack((current) => [...current.slice(-199), draftContent])
    setRedoStack([])
    draftRef.current = nextContent
    setDraftContent(nextContent)
  }, [draftContent])

  const undoDraft = useCallback(() => {
    setUndoStack((current) => {
      if (current.length === 0) return current
      const previous = current[current.length - 1]
      setRedoStack((redo) => [...redo.slice(-199), draftContent])
      draftRef.current = previous
      setDraftContent(previous)
      return current.slice(0, -1)
    })
  }, [draftContent])

  const redoDraft = useCallback(() => {
    setRedoStack((current) => {
      if (current.length === 0) return current
      const next = current[current.length - 1]
      setUndoStack((undo) => [...undo.slice(-199), draftContent])
      draftRef.current = next
      setDraftContent(next)
      return current.slice(0, -1)
    })
  }, [draftContent])

  const saveContentDirectly = useCallback(async (nextContent: string, imageSource?: string) => {
    if (!document?.file_path) return
    const target = document
    transitionVersionRef.current += 1
    let base = imageBaseRef.current
    if (imageSource) {
      if (!base || base.id !== target.id || !projectMarkdownImages(base, readerContent)) {
        base = { id: target.id, rawContent: readerContent,
          content: readerContent === (target.raw_content ?? target.content) ? target.content : readerContent, sources: [] }
      }
      if (!base.sources.includes(imageSource)) base.sources.push(imageSource)
      imageBaseRef.current = base
    }
    setImagePreview(base?.id === target.id ? projectMarkdownImages(base, nextContent) : null)
    const version = ++saveVersionRef.current
    // Reader edits paint immediately; persistence shares the draft save queue.
    draftRef.current = nextContent
    setDraftContent(nextContent)
    setEditDocumentId(target.id)
    setPreviewPending(true)
    setSavePending(true)
    const task = saveQueue.enqueue(async () => {
      const { file } = await persistence.save({ path: target.file_path, content: nextContent })
      saveQueue.remember(target.file_path, file.raw_content ?? file.content)
      persistence.applySavedFile(file, target)
      if (currentDocumentRef.current?.id === target.id && saveVersionRef.current === version
        && draftRef.current === nextContent) {
        setDraftContent(file.raw_content ?? file.content)
        setPreviewPending(false)
      }
      void persistence.refreshMaterials().catch(() => {
        interaction.setNotice(t("정리본은 저장됐지만 자료 목록을 갱신하지 못했습니다."))
      })
    })
    try {
      await task
    } catch (error) {
      // Retain the latest unsaved text and its undo history for retry.
      if (currentDocumentRef.current?.id === target.id && saveVersionRef.current === version) {
        beforeModeChangeRef.current?.(true)
        setEditMode(true)
        setPreviewPending(false)
      }
      interaction.setNotice(t("저장 실패: {p0}", { p0: error instanceof Error ? error.message : String(error) }))
      throw error
    } finally {
      if (saveVersionRef.current === version) setSavePending(false)
    }
  }, [document, interaction, persistence, readerContent, saveQueue])

  const undoDirectly = useCallback(async () => {
    if (!document || undoStack.length === 0) return
    const currentContent = readerContent
    const previous = undoStack[undoStack.length - 1]
    setUndoStack((undo) => undo.slice(0, -1))
    setRedoStack((redo) => [...redo.slice(-199), currentContent])
    await interaction.runInteraction("viewer-undo", t("실행 취소"), async () => {
      await saveContentDirectly(previous)
      return t("이전 변경 사항을 취소했습니다.")
    }, undefined, { replace: true })
  }, [document, interaction, readerContent, saveContentDirectly, undoStack])

  const redoDirectly = useCallback(async () => {
    if (!document || redoStack.length === 0) return
    const currentContent = readerContent
    const next = redoStack[redoStack.length - 1]
    setRedoStack((redo) => redo.slice(0, -1))
    setUndoStack((undo) => [...undo.slice(-199), currentContent])
    await interaction.runInteraction("viewer-redo", t("다시 실행"), async () => {
      await saveContentDirectly(next)
      return t("변경 사항을 다시 실행했습니다.")
    }, undefined, { replace: true })
  }, [document, interaction, readerContent, redoStack, saveContentDirectly])

  async function handleHighlightText(selectedText: string) {
    if (!document?.file_path) return
    const content = readerContent
    const trimmedText = selectedText.trim()
    if (!content || !trimmedText) return

    const highlightedPattern = `==${trimmedText}==`
    let nextContent = content
    if (content.includes(highlightedPattern)) nextContent = content.replace(highlightedPattern, trimmedText)
    else if (content.includes(trimmedText)) nextContent = content.replace(trimmedText, highlightedPattern)
    else {
      interaction.setNotice(t("정리본 문서에서 정확히 일치하는 텍스트를 찾지 못했습니다."))
      return
    }

    if (editMode) changeDraft(nextContent)
    else {
      await interaction.runInteraction("viewer-highlight", t("하이라이트 적용"), async () => {
        await saveContentDirectly(nextContent)
        return t("선택한 텍스트를 하이라이트했습니다.")
      })
    }
  }

  async function handleImageDoubleClick(src: string, alt: string) {
    void alt
    if (!document?.file_path) return
    const content = readerContent
    const nextContent = removeImageFromMarkdown(content, src)
    if (nextContent === content) {
      interaction.setNotice(t("정리본 문서에서 해당 이미지의 링크 텍스트를 찾지 못했습니다."))
      return
    }

    if (editMode) {
      changeDraft(nextContent)
      interaction.setNotice(t("선택한 이미지의 링크 텍스트를 지웠습니다."))
    } else {
      setUndoStack((undo) => [...undo.slice(-199), content])
      setRedoStack([])
      await interaction.runInteraction("image-delete", t("이미지 제거"), async () => {
        await saveContentDirectly(nextContent, src)
        return t("선택한 이미지의 링크 텍스트를 지웠습니다.")
      }, undefined, { replace: true })
    }
  }

  async function removeTopVisibleImage() {
    const container = scroll.fullscreen ? scroll.getFullscreenContainer() : scroll.getPrimaryContainer()
    if (!container || !document?.file_path) return
    const images = Array.from(container.querySelectorAll("img"))
    if (images.length === 0) {
      interaction.setNotice(t("화면에 표시할 이미지가 없습니다."))
      return
    }

    const containerRect = container.getBoundingClientRect()
    let bestImg: HTMLImageElement | null = null
    let minTopDiff = Infinity
    for (const image of images) {
      const rect = image.getBoundingClientRect()
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
        const topDiff = Math.abs(rect.top - containerRect.top)
        if (topDiff < minTopDiff) {
          minTopDiff = topDiff
          bestImg = image
        }
      }
    }
    if (!bestImg) {
      bestImg = images.find((image) => image.getBoundingClientRect().top >= containerRect.bottom) ?? null
    }
    if (!bestImg) {
      interaction.setNotice(t("화면에 보이고 있는 이미지가 없습니다."))
      return
    }
    const src = bestImg.getAttribute("data-markdown-image-source") || bestImg.getAttribute("src") || ""
    if (!src) {
      interaction.setNotice(t("선택된 이미지의 src 주소를 찾을 수 없습니다."))
      return
    }
    await handleImageDoubleClick(src, bestImg.getAttribute("alt") || "")
  }

  function handleViewerEditKeyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase()
    if (key === "tab") {
      event.preventDefault()
      event.stopPropagation()
      if (editMode) void leaveEditMode(true)
      else enterEditMode()
      return
    }
    if (!editMode) return
    if ((event.ctrlKey || event.metaKey) && key === "s") {
      event.preventDefault()
      event.stopPropagation()
      void saveDraft()
      return
    }
    if ((event.ctrlKey || event.metaKey) && ((key === "z" && event.shiftKey) || key === "y")) {
      event.preventDefault()
      event.stopPropagation()
      redoDraft()
      return
    }
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault()
      event.stopPropagation()
      undoDraft()
    }
  }

  const applyMarkdownContent = useCallback(async (content: string, previousContent: string) => {
    if (editMode) {
      changeDraft(content)
      return
    }
    setUndoStack((undo) => [...undo.slice(-199), previousContent])
    setRedoStack([])
    await saveContentDirectly(content)
  }, [changeDraft, editMode, saveContentDirectly])

  const moveEditDocumentPath = useCallback((oldPath: string, newPath: string, imageUpdates: MaterialImageLinkUpdate[] = []) => {
    const oldPrefix = oldPath.replace(/\\/g, "/")
    const newPrefix = newPath.replace(/\\/g, "/")
    setEditDocumentId((current) => {
      const normalized = current.replace(/\\/g, "/")
      if (normalized !== oldPrefix && !normalized.startsWith(`${oldPrefix}/`)) return current
      return `${newPrefix}${normalized.slice(oldPrefix.length)}`.replace(/\//g, "\\")
    })
    const loadedPath = lastLoadedFileRef.current.replace(/\\/g, "/")
    if (loadedPath === oldPrefix || loadedPath.startsWith(`${oldPrefix}/`)) {
      lastLoadedFileRef.current = `${newPrefix}${loadedPath.slice(oldPrefix.length)}`.replace(/\//g, "\\")
    }
    const currentPath = (editDocumentId || document?.file_path || "").replace(/\\/g, "/")
    if (currentPath !== oldPrefix && !currentPath.startsWith(`${oldPrefix}/`)) return
    const nextPath = `${newPrefix}${currentPath.slice(oldPrefix.length)}`.replace(/\//g, "\\")
    const replacements = imageUpdates.find((item) => item.file_path === nextPath)?.replacements
    if (!replacements?.length) return
    setDraftContent((current) => rewriteMovedImageSources(current, replacements))
    setUndoStack((current) => current.map((content) => rewriteMovedImageSources(content, replacements)))
    setRedoStack((current) => current.map((content) => rewriteMovedImageSources(content, replacements)))
  }, [document?.file_path, editDocumentId])

  const replaceEditDocumentId = useCallback((oldId: string, newId: string) => {
    setEditDocumentId((current) => current === oldId ? newId : current)
  }, [])

  const editor: ViewerMarkdownEditorModel = {
    content: readerContent,
    onChange: changeDraft,
    onKeyDown: handleViewerEditKeyDown,
    redoCount: redoStack.length,
    textareaRef: editingTextareaRef,
    beforeModeChangeRef,
    undoCount: undoStack.length,
    imagePreview: !editMode && editDocumentId === document?.id && imagePreview?.currentContent === readerContent
      ? imagePreview : undefined,
  }

  return {
    actions: {
      applyMarkdownContent,
      applySavedFile,
      changeDraft,
      restoreTransferredEdit: (snapshot: DocumentEditTransfer) => {
        lastLoadedFileRef.current = snapshot.id
        setEditDocumentId(snapshot.id)
        setDraftContent(snapshot.draft)
        setEditMode(snapshot.editing)
        setPreviewPending(false)
        setUndoStack(snapshot.undo)
        setRedoStack(snapshot.redo)
      },
      enterEditMode,
      handleHighlightText,
      handleImageDoubleClick,
      handleViewerEditKeyDown,
      leaveEditMode,
      moveEditDocumentPath,
      redoDirectly,
      redoDraft,
      removeTopVisibleImage,
      replaceEditDocumentId,
      reset,
      saveContentDirectly,
      saveDraft,
      undoDirectly,
      undoDraft,
    },
    editor,
    refs: { editingTextareaRef },
    state: {
      draftContent,
      editDocumentId,
      editMode: editMode && editDocumentId === document?.id,
      previewPending: previewPending && editDocumentId === document?.id,
      savePending,
      redoStack,
      undoStack,
    },
  }
}
