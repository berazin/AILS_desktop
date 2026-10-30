import { useEffect, type RefObject } from "react"

import type { MaterialsController } from "../../materials/hooks/use-materials-controller.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { useMaterialDocumentWorkflows } from "../../materials/hooks/use-material-document-workflows.ts"
import { useMaterialPracticeWorkflow } from "../../materials/hooks/use-material-practice-workflow.ts"
import { useMaterialsWorkflows } from "../../materials/hooks/use-materials-workflows.ts"
import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import { useViewerEditingWorkflow } from "../../document/hooks/use-viewer-editing-workflow.ts"
import { viewerFromMaterial } from "../../../lib/viewer-document.ts"
import { normalizedMaterialPath } from "../../../lib/material-navigation.ts"
import { saveMaterialFile } from "../../../lib/api"

type DocumentOptions = Parameters<typeof useMaterialDocumentWorkflows>[0]
type PracticeOptions = Parameters<typeof useMaterialPracticeWorkflow>[0]
type MaterialOptions = Parameters<typeof useMaterialsWorkflows>[0]

type UseDocumentMaterialWorkspaceOptions = {
  documents: DocumentOptions["documents"] & {
    items: MaterialOptions["documents"]["items"]
    selectedId: string
  }
  interaction: {
    refreshStatus: MaterialOptions["interaction"]["refreshStatus"]
    runInteraction: DocumentOptions["runInteraction"]
    setNotice: DocumentOptions["setNotice"]
  }
  materials: MaterialsController
  getHomeChatSnapshot: PracticeOptions["getHomeChatSnapshot"]
  ocrExclusion: MaterialOptions["ocrExclusion"]
  pdf: PdfController
  prepareFolderPdfOcr: PracticeOptions["prepareFolderPdfOcr"]
  recent: MaterialOptions["recent"]
  scroll: {
    fullscreen: boolean
    fullscreenViewerRef: RefObject<HTMLElement | null>
    primaryViewerRef: RefObject<HTMLElement | null>
    treeRef: RefObject<HTMLDivElement | null>
  }
  workspaceSurface: WorkspaceSurface
}

export function useDocumentMaterialWorkspace({
  documents,
  interaction,
  materials,
  getHomeChatSnapshot,
  ocrExclusion,
  pdf,
  prepareFolderPdfOcr,
  recent,
  scroll,
  workspaceSurface,
}: UseDocumentMaterialWorkspaceOptions) {
  const document = useMaterialDocumentWorkflows({
    documents,
    loadFile: materials.actions.loadFile,
    pdf,
    recentFiles: { set: recent.setFiles },
    runInteraction: interaction.runInteraction,
    setNotice: interaction.setNotice,
  })
  const practice = useMaterialPracticeWorkflow({
    windows: {
      activeDocumentId: workspaceSurface === "document" ? documents.viewerDocument?.id ?? "" : "",
      documents: documents.items,
      viewerDocument: documents.viewerDocument,
      openDocument: async (path) => {
        const existing = documents.items.find(item => normalizedMaterialPath(item.file_path ?? "").toLowerCase() === normalizedMaterialPath(path).toLowerCase())
        const next = existing ?? viewerFromMaterial((await materials.actions.loadFile(path)).file)
        document.showDocument(next, true)
        return next
      },
    },
    getHomeChatSnapshot,
    applySavedPdfPage: document.applySavedPdfPage,
    materials,
    prepareFolderPdfOcr,
    runInteraction: interaction.runInteraction,
    setDocuments: documents.setDocuments,
    setNotice: interaction.setNotice,
    setSelectedDocumentId: documents.setSelectedDocumentId,
    setSelectedReportId: documents.setSelectedReportId,
    setWorkspaceSurface: documents.setWorkspaceSurface,
  })
  const editing = useViewerEditingWorkflow({
    document: documents.viewerDocument,
    interaction,
    persistence: {
      save: saveMaterialFile,
      applySavedFile: document.applySavedFileState,
      refreshMaterials: materials.actions.refreshLectureMaterials,
    },
    scroll: {
      fullscreen: scroll.fullscreen,
      getFullscreenContainer: () => scroll.fullscreenViewerRef.current ?? scroll.primaryViewerRef.current,
      getPrimaryContainer: () => scroll.primaryViewerRef.current,
    },
  })
  const materialWorkflows = useMaterialsWorkflows({
    documents: {
      applySavedPdfPage: document.applySavedPdfPage,
      items: documents.items,
      selectedId: documents.selectedId,
      setDocuments: documents.setDocuments,
      setSelectedId: documents.setSelectedDocumentId,
    },
    editing: {
      documentId: editing.state.editDocumentId,
      moveDocumentPath: editing.actions.moveEditDocumentPath,
      replaceDocumentId: editing.actions.replaceEditDocumentId,
      reset: editing.actions.reset,
    },
    interaction: {
      refreshStatus: interaction.refreshStatus,
      runInteraction: interaction.runInteraction,
    },
    materials,
    ocrExclusion,
    recent,
    scroll: {
      getTreeContainer: () => scroll.treeRef.current,
    },
  })
  const onHighlightText = useEventCallback((text: string) => {
    void editing.actions.handleHighlightText(text)
  })
  const onImageDoubleClick = useEventCallback((src: string, alt: string) => {
    void editing.actions.handleImageDoubleClick(src, alt)
  })
  const cancelOpen = document.cancelOpen
  const closeLinkedMarkdown = document.closeLinkedMarkdown
  const resetEditing = editing.actions.reset
  const {
    setDocuments,
    setSelectedDocumentId,
    setSelectedReport,
    setSelectedReportId,
  } = documents

  useEffect(() => {
    if (workspaceSurface !== "home") return
    cancelOpen()
    setSelectedReportId("")
    setSelectedReport(null)
    setSelectedDocumentId("")
    setDocuments((current) => current.length === 0 ? [] : current)
    resetEditing()
    closeLinkedMarkdown()
  }, [cancelOpen, closeLinkedMarkdown, resetEditing, setDocuments, setSelectedDocumentId, setSelectedReport, setSelectedReportId, workspaceSurface])

  return {
    document,
    editing,
    markdown: {
      onHighlightText,
      onImageDoubleClick,
    },
    materials: materialWorkflows,
    practice,
  }
}

export type DocumentMaterialWorkspace = ReturnType<typeof useDocumentMaterialWorkspace>
