import { useState, type Dispatch, type DragEvent as ReactDragEvent, type SetStateAction } from "react"

import { openLocalPath, restoreMaterialTrashItem, saveConfig, type LectureMaterialFolder, type MaterialImageLinkUpdate, type MaterialTransferRequest } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { extractViewerFilename } from "../../../lib/viewer-editing.ts"
import { viewerFromMaterial, type ViewerDocument } from "../../../lib/viewer-document.ts"
import { isMaterialPathInside, MATERIAL_DRAG_MIME, MATERIAL_FOLDER_DRAG_MIME, type MaterialBulkDeleteTarget, type MaterialsController, type MaterialTrashContextTarget } from "./use-materials-controller.ts"
import { type MaterialContextTarget, type MaterialFolderContextTarget } from "../../../lib/material-navigation.ts"

type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
  onError?: (error: unknown) => void,
) => Promise<void>

type RecentFile = {
  kind: string
  lastOpenedAt?: string
  pageCount?: number
  path: string
  title: string
}

type UseMaterialsWorkflowsOptions = {
  documents: {
    applySavedPdfPage: (document: ViewerDocument) => void
    items: ViewerDocument[]
    selectedId: string
    setDocuments: Dispatch<SetStateAction<ViewerDocument[]>>
    setSelectedId: Dispatch<SetStateAction<string>>
  }
  editing: {
    documentId: string
    moveDocumentPath: (oldPath: string, newPath: string, imageUpdates?: MaterialImageLinkUpdate[]) => void
    replaceDocumentId: (oldId: string, newId: string) => void
    reset: () => void
  }
  interaction: {
    refreshStatus: () => Promise<unknown>
    runInteraction: RunInteraction
  }
  materials: MaterialsController
  ocrExclusion: {
    paths: string[] | undefined
    setNotice: (message: string) => void
    setPaths: (paths: string[]) => void
  }
  recent: {
    files: RecentFile[]
    setFiles: Dispatch<SetStateAction<RecentFile[]>>
  }
  scroll: {
    getTreeContainer: () => HTMLElement | null
  }
}

function persistRecentFiles(files: RecentFile[]) {
  localStorage.setItem("ails-recent-files", JSON.stringify(files))
  return files
}

export function useMaterialsWorkflows({
  documents,
  editing,
  interaction,
  materials,
  ocrExclusion,
  recent,
  scroll,
}: UseMaterialsWorkflowsOptions) {
  const [pendingTrashRestore, setPendingTrashRestore] = useState<MaterialTrashContextTarget | null>(null)
  const {
    actions: {
      createFolder: createMaterialsFolder,
      loadFile,
      moveEntry,
      transferEntries,
      moveFile,
      removeBulk,
      removeFile,
      removeFolder,
      removeTrashItem,
      renameFile,
      renameFolder,
    },
    data: { lectureMaterials },
    editing: { editingFolderName, editingFolderPath, setEditingFolderName, setEditingFolderPath },
    menus: {
      setMaterialBulkContextMenu,
      setMaterialContextMenu,
      setMaterialFolderContextMenu,
      setMaterialTrashContextMenu,
    },
    pendingDelete: {
      pendingBulkDelete,
      pendingFileDelete,
      pendingFolderDelete,
      setPendingBulkDelete,
      setPendingFileDelete,
      setPendingFolderDelete,
    },
    tree: { setMaterialDropTargetPath },
  } = materials

  async function toggleOcrExclusion(targetPath: string) {
    if (!targetPath) return
    const normTarget = targetPath.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")
    const currentList = Array.isArray(ocrExclusion.paths) ? [...ocrExclusion.paths] : []
    const existingIndex = currentList.findIndex(
      (path) => String(path || "").replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "") === normTarget,
    )
    const isAdding = existingIndex < 0
    const nextList = isAdding
      ? [...currentList, targetPath]
      : currentList.filter((_, index) => index !== existingIndex)
    ocrExclusion.setPaths(nextList)
    try {
      await saveConfig({ background_document_ocr_excluded_paths: nextList })
      ocrExclusion.setNotice(isAdding ? t("OCR 제외 목록에 추가했습니다.") : t("OCR 제외를 해제했습니다."))
    } catch (error) {
      console.error("Failed to save OCR excluded paths", error)
      const message = error instanceof Error ? error.message : String(error)
      ocrExclusion.setNotice(t("설정 저장에 실패했습니다: {p0}", { p0: message }))
    }
  }

  async function setOcrExclusions(targetPaths: readonly string[], excluded: boolean) {
    const key = (path: string) => path.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")
    const targets = new Map(targetPaths.filter(Boolean).map(path => [key(path), path]))
    if (!targets.size) return
    const currentList = ocrExclusion.paths ?? []
    const nextList = currentList.filter(path => !targets.has(key(path)))
    if (excluded) nextList.push(...targets.values())
    // One persisted update for the whole selection avoids stale single-file
    // toggle closures overwriting earlier items in the same batch.
    await saveConfig({ background_document_ocr_excluded_paths: nextList })
    ocrExclusion.setPaths(nextList)
    ocrExclusion.setNotice(excluded ? t("OCR 제외 목록에 추가했습니다.") : t("OCR 제외를 해제했습니다."))
  }

  async function createFolder(parentPath?: string) {
    await interaction.runInteraction("material-folder-create", t("강의자료 폴더 생성"), async () => {
      const result = await createMaterialsFolder(parentPath)
      return t("강의자료 폴더를 만들었습니다: {p0}", { p0: result.folder.name })
    })
  }

  async function commitFolderRename(path: string, requestedName?: string) {
    const name = (requestedName ?? editingFolderName).trim()
    if (requestedName === undefined && (!editingFolderPath || editingFolderPath !== path)) return { error: "" }
    if (!name) {
      setEditingFolderPath("")
      setEditingFolderName("")
      return { error: "" }
    }
    if (name === path.split(/[\\/]/).pop()) {
      if (requestedName === undefined) { setEditingFolderPath(""); setEditingFolderName("") }
      return { error: "", path }
    }
    let error = "", renamedPath = ""
    await interaction.runInteraction(`material-folder-rename-${path}`, t("강의자료 폴더 이름 변경"), async () => {
      const result = await renameFolder(path, name)
      // The disk rename has committed. A later viewer reload failure must not
      // invite retrying the old path, so preserve the new path with a warning.
      renamedPath = result.folder.path
      await moveEntryPath(path, renamedPath)
      return t("폴더 이름을 변경했습니다: {p0}", { p0: result.folder.name })
    }, failure => { error = failure instanceof Error ? failure.message : String(failure) })
    return renamedPath ? { error: "", path: renamedPath, ...(error ? { warning: error } : {}) }
      : { error: error || t("폴더 이름 변경을 완료하지 못했습니다.") }
  }

  function autoScrollTreeDuringDrag(event: ReactDragEvent<HTMLElement>) {
    const container = scroll.getTreeContainer()
    if (!container) return
    const rect = container.getBoundingClientRect()
    const edgeSize = 56
    const maxStep = 18
    if (event.clientY < rect.top + edgeSize) {
      const ratio = Math.min(1, Math.max(0, (rect.top + edgeSize - event.clientY) / edgeSize))
      container.scrollTop -= Math.ceil(maxStep * ratio)
    } else if (event.clientY > rect.bottom - edgeSize) {
      const ratio = Math.min(1, Math.max(0, (event.clientY - (rect.bottom - edgeSize)) / edgeSize))
      container.scrollTop += Math.ceil(maxStep * ratio)
    }
  }

  async function moveEntryPath(oldPath: string, newPath: string, imageUpdates?: MaterialImageLinkUpdate[]) {
    const oldPrefix = oldPath.replace(/\\/g, "/")
    const newPrefix = newPath.replace(/\\/g, "/")
    documents.setDocuments((current) => current.map((item) => {
      const normalizedPath = item.file_path.replace(/\\/g, "/")
      if (normalizedPath !== oldPrefix && !normalizedPath.startsWith(`${oldPrefix}/`)) return item
      const nextPath = `${newPrefix}${normalizedPath.slice(oldPrefix.length)}`.replace(/\//g, "\\")
      return { ...item, id: nextPath, file_path: nextPath }
    }))
    const selectedPath = documents.selectedId.replace(/\\/g, "/")
    if (selectedPath === oldPrefix || selectedPath.startsWith(`${oldPrefix}/`)) {
      documents.setSelectedId(`${newPrefix}${selectedPath.slice(oldPrefix.length)}`.replace(/\//g, "\\"))
    }
    editing.moveDocumentPath(oldPath, newPath, imageUpdates)
    recent.setFiles((current) => persistRecentFiles(current.map((item) => {
      const normalizedPath = item.path.replace(/\\/g, "/")
      if (normalizedPath !== oldPrefix && !normalizedPath.startsWith(`${oldPrefix}/`)) return item
      return {
        ...item,
        path: `${newPrefix}${normalizedPath.slice(oldPrefix.length)}`.replace(/\//g, "\\"),
      }
    })))
    // Cached markdown contains absolute /api/files image URLs from its old location.
    // Refresh saved viewer content while the editing controller retains its draft.
    try {
      const refreshed = await Promise.all(documents.items
        .filter((item) => item.kind === "md" && isMaterialPathInside(item.file_path, oldPath))
        .map(async (item) => {
          const path = item.file_path.replace(/\\/g, "/")
          const nextPath = `${newPrefix}${path.slice(oldPrefix.length)}`.replace(/\//g, "\\")
          const { file } = await loadFile(nextPath)
          return viewerFromMaterial(file)
        }))
      const byPath = new Map(refreshed.map((item) => [item.file_path, item]))
      documents.setDocuments((current) => current.map((item) => {
        const refreshed = byPath.get(item.file_path)
        return refreshed ? { ...item, ...refreshed, source: item.source } : item
      }))
    } catch (error) {
      throw new Error(t("자료 이동은 완료됐지만 열린 정리본을 다시 읽지 못했습니다: {p0}", { p0: error instanceof Error ? error.message : String(error) }), { cause: error })
    }
  }

  async function pasteWorkspaceEntries(payload: MaterialTransferRequest) {
    const result = await transferEntries(payload)
    for (const entry of result.results) {
      if (entry.status !== "moved" || !entry.new_path) continue
      try { await moveEntryPath(entry.old_path, entry.new_path, entry.image_link_updates) }
      catch (error) { entry.warning = error instanceof Error ? error.message : String(error) }
    }
    // A refresh failure after the disk operation must not repeat completed cuts.
    try { await interaction.refreshStatus() }
    catch (error) {
      const entry = result.results.find(entry => entry.status !== "error")
      if (entry) entry.warning = [entry.warning, t("붙여넣기는 완료됐지만 상태 갱신에 실패했습니다: {p0}", {
        p0: error instanceof Error ? error.message : String(error),
      })].filter(Boolean).join("\n")
    }
    return result
  }

  async function dropOnFolder(event: ReactDragEvent<HTMLElement>, folder: LectureMaterialFolder) {
    event.preventDefault()
    event.stopPropagation()
    setMaterialDropTargetPath("")
    const sourceFolderPath = event.dataTransfer.getData(MATERIAL_FOLDER_DRAG_MIME)
    if (sourceFolderPath) {
      if (sourceFolderPath === folder.path) return
      await interaction.runInteraction(`material-folder-move-${sourceFolderPath}`, t("강의자료 폴더 이동"), async () => {
        const result = await moveEntry(sourceFolderPath, folder.path)
        if (result.moved) await moveEntryPath(result.old_path, result.new_path, result.image_link_updates)
        return result.moved
          ? t("폴더를 {p0} 폴더로 이동했습니다.", { p0: folder.name })
          : t("이미 같은 위치에 있는 폴더입니다.")
      })
      return
    }
    const sourcePath = event.dataTransfer.getData(MATERIAL_DRAG_MIME)
    if (!sourcePath) return
    await interaction.runInteraction(`material-move-${sourcePath}`, t("강의자료 파일 이동"), async () => {
      const result = await moveFile(sourcePath, folder.path)
      if (result.moved) await moveEntryPath(result.old_path, result.new_path, result.image_link_updates)
      return result.moved
        ? t("파일을 {p0} 폴더로 이동했습니다.", { p0: folder.name })
        : t("이미 같은 폴더에 있는 파일입니다.")
    })
  }

  async function dropOnBase(event: ReactDragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes(MATERIAL_FOLDER_DRAG_MIME) && !event.dataTransfer.types.includes(MATERIAL_DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    setMaterialDropTargetPath("")
    const basePath = lectureMaterials?.base_path
    if (!basePath) return
    const sourcePath = event.dataTransfer.getData(MATERIAL_FOLDER_DRAG_MIME) || event.dataTransfer.getData(MATERIAL_DRAG_MIME)
    if (!sourcePath) return
    await interaction.runInteraction(`material-entry-move-base-${sourcePath}`, t("강의자료 이동"), async () => {
      const result = await moveEntry(sourcePath, basePath)
      if (result.moved) await moveEntryPath(result.old_path, result.new_path, result.image_link_updates)
      return result.moved ? t("강의자료를 최상위 폴더로 이동했습니다.") : t("이미 최상위 폴더에 있습니다.")
    })
  }

  async function renameFileTarget(target: MaterialContextTarget, requestedName?: string) {
    setMaterialContextMenu(null)
    const nextName = requestedName ?? window.prompt(t("파일 이름"), target.fileName)
    if (nextName === null) return { error: "" }
    const trimmedName = nextName.trim()
    if (!trimmedName || trimmedName === target.fileName) return { error: "" }
    let error = "", renamedPath = ""
    await interaction.runInteraction(`material-rename-${target.path}`, "material rename", async () => {
      const result = await renameFile(target.path, trimmedName)
      const document = viewerFromMaterial(result.file)
      documents.applySavedPdfPage(document)
      documents.setDocuments((current) => current
        .map((item) => item.file_path === result.old_path ? document : item)
        .filter((item) => item.file_path !== result.old_path || item.id === document.id))
      if (documents.selectedId === result.old_path) documents.setSelectedId(document.id)
      editing.replaceDocumentId(result.old_path, document.id)
      recent.setFiles((current) => persistRecentFiles(current.map((file) => file.path === result.old_path
        ? { ...file, path: document.id, title: document.title }
        : file)))
      renamedPath = document.file_path
      return t("파일 이름을 변경했습니다: {p0}", { p0: result.file.title })
    }, failure => { error = failure instanceof Error ? failure.message : String(failure) })
    return renamedPath ? { error: "", path: renamedPath } : { error: error || t("파일 이름 변경을 완료하지 못했습니다.") }
  }

  function requestDeleteFile(target: MaterialContextTarget) {
    setMaterialContextMenu(null)
    setPendingFileDelete(target)
  }

  function requestDeleteFolder(target: MaterialFolderContextTarget) {
    setMaterialFolderContextMenu(null)
    setPendingFolderDelete(target)
  }

  function requestDeleteBulk(target: MaterialBulkDeleteTarget) {
    setMaterialBulkContextMenu(null)
    setPendingBulkDelete(target)
  }

  function moveDashboardItemToTrash(path: string) {
    if (!path) return
    const folders = [...(lectureMaterials?.folders ?? [])]
    for (const folder of folders) {
      if (!folder.is_virtual && folder.path === path) {
        requestDeleteFolder({
          path: folder.path,
          name: folder.name,
          weeks: folder.weeks.map((week) => week.week),
          reportCount: folder.report_count + folder.files.filter((file) => file.kind === "md").length,
          folder,
        })
        return
      }
      const file = folder.files.find((item) => item.file_path === path)
      const report = folder.weeks.flatMap((week) => week.reports).find((item) => item.file_path === path)
      const target = file ?? report
      if (target) {
        requestDeleteFile({
          path: target.file_path,
          fileName: target.file_name,
          title: target.title,
          kind: file?.kind ?? "md",
        })
        return
      }
      folders.push(...(folder.children ?? []))
    }
    if (recent.files.some((file) => file.path === path)) {
      void interaction.runInteraction(`material-delete-prepare-${path}`, t("강의자료 파일 삭제"), async () => {
        const { file } = await loadFile(path)
        requestDeleteFile({
          path: file.file_path,
          fileName: extractViewerFilename(file.file_path),
          title: file.title,
          kind: file.kind,
        })
      })
    }
  }

  async function confirmDeleteFile() {
    const target = pendingFileDelete
    if (!target) return
    setPendingFileDelete(null)
    await interaction.runInteraction(`material-delete-${target.path}`, t("강의자료 파일 삭제"), async () => {
      const result = await removeFile(target)
      documents.setDocuments((current) => current.filter((item) => item.file_path !== result.path))
      if (documents.selectedId === result.path) documents.setSelectedId("")
      if (editing.documentId === result.path) editing.reset()
      recent.setFiles((current) => persistRecentFiles(current.filter((file) => file.path !== result.path)))
      await interaction.refreshStatus()
      return t("파일을 삭제했습니다: {p0}", { p0: target.fileName })
    })
  }

  async function confirmDeleteFolder() {
    const target = pendingFolderDelete
    if (!target) return
    await interaction.runInteraction(`material-folder-delete-${target.path}`, t("강의자료 폴더 삭제"), async () => {
      const result = await removeFolder(target)
      setPendingFolderDelete(null)
      documents.setDocuments((current) => current.filter((item) => !item.file_path.startsWith(`${result.path}\\`) && !item.file_path.startsWith(`${result.path}/`)))
      if (documents.selectedId && isMaterialPathInside(documents.selectedId, result.path)) documents.setSelectedId("")
      recent.setFiles((current) => persistRecentFiles(current.filter((file) => !isMaterialPathInside(file.path, result.path))))
      return t("폴더를 삭제했습니다: {p0}", { p0: target.name })
    })
  }

  async function confirmDeleteBulk() {
    const target = pendingBulkDelete
    if (!target) return
    setPendingBulkDelete(null)
    await interaction.runInteraction("material-bulk-delete", t("선택 강의자료 삭제"), async () => {
      const removedPaths = await removeBulk(target)
      documents.setDocuments((current) => current.filter((item) => !removedPaths.some((path) => isMaterialPathInside(item.file_path, path))))
      if (documents.selectedId && removedPaths.some((path) => isMaterialPathInside(documents.selectedId, path))) documents.setSelectedId("")
      if (editing.documentId && removedPaths.some((path) => isMaterialPathInside(editing.documentId, path))) editing.reset()
      recent.setFiles((current) => persistRecentFiles(current.filter((file) => !removedPaths.some((path) => isMaterialPathInside(file.path, path)))))
      await interaction.refreshStatus()
      return t("선택한 강의자료 {p0}개를 삭제했습니다.", { p0: removedPaths.length })
    })
  }

  async function openTrashItem(path: string) {
    await interaction.runInteraction(`trash-open-${path}`, t("휴지통 항목 열기"), async () => {
      await openLocalPath(path)
      return t("휴지통 항목을 열었습니다.")
    })
  }

  async function deleteTrashItem(target: MaterialTrashContextTarget) {
    setMaterialTrashContextMenu(null)
    await interaction.runInteraction(`trash-delete-${target.path}`, t("휴지통 항목 삭제"), async () => {
      await removeTrashItem(target)
      return t("휴지통에서 완전히 삭제했습니다: {p0}", { p0: target.name })
    })
  }

  function requestRestoreTrashItem(target: MaterialTrashContextTarget) {
    setMaterialTrashContextMenu(null)
    setPendingTrashRestore(target)
  }

  async function confirmRestoreTrashItem(targetFolderPath: string, newName: string) {
    const target = pendingTrashRestore
    if (!target) return
    await interaction.runInteraction(`trash-restore-${target.path}`, t("휴지통 항목 복원"), async () => {
      const result = await restoreMaterialTrashItem({
        path: target.path,
        target_folder_path: targetFolderPath,
        new_name: newName,
      })
      materials.data.setLectureMaterials(result.materials)
      setPendingTrashRestore(null)
      return t("자료를 복원했습니다: {p0}", { p0: newName })
    })
  }

  return {
    autoScrollTreeDuringDrag,
    commitFolderRename,
    confirmDeleteBulk,
    confirmDeleteFile,
    confirmDeleteFolder,
    createFolder,
    deleteTrashItem,
    confirmRestoreTrashItem,
    dropOnBase,
    dropOnFolder,
    pasteWorkspaceEntries,
    moveDashboardItemToTrash,
    openTrashItem,
    pendingTrashRestore,
    requestRestoreTrashItem,
    setPendingTrashRestore,
    renameFileTarget,
    requestDeleteBulk,
    requestDeleteFile,
    requestDeleteFolder,
    toggleOcrExclusion,
    setOcrExclusions,
  }
}

export type MaterialsWorkflows = ReturnType<typeof useMaterialsWorkflows>
