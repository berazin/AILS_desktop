import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
} from "react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { t } from "../../../lib/i18n.ts"
import { normalizedMaterialPath, type MaterialContextTarget, type MaterialFolderContextTarget } from "../../../lib/material-navigation.ts"
import { hideDeletingMaterialFiles } from "../optimistic-file-deletion.ts"
import { useMaterialCatalog } from "./use-material-catalog.ts"

import {
  createMaterialFolder,
  deleteMaterialFile,
  deleteMaterialFolder,
  deleteMaterialTrashItem,
  getMaterialFile,
  moveMaterialEntry,
  moveMaterialFile,
  transferMaterialEntries,
  type MaterialTransferRequest,
  renameMaterialFile,
  renameMaterialFolder,
  type LectureMaterialFile,
  type LectureMaterialFolder,
  type LectureMaterialReport,
  type LectureMaterialTrashItem,
  type LectureMaterialsPayload,
} from "../../../lib/api"



export type MaterialTrashContextTarget = LectureMaterialTrashItem

export type MaterialSelectionItem = {
  key: string
  label: string
  files: MaterialContextTarget[]
  folder?: MaterialFolderContextTarget
}

export type MaterialBulkDeleteTarget = {
  files: MaterialContextTarget[]
  folders: MaterialFolderContextTarget[]
}

export const MATERIAL_DRAG_MIME = "application/x-ails-material-file"
export const MATERIAL_FOLDER_DRAG_MIME = "application/x-ails-material-folder"


export function materialFolderSelectionKey(path: string) {
  return `folder:${path}`
}

export function materialFilesSelectionKey(path: string) {
  return `files:${path}`
}

export function materialWeekSelectionKey(path: string, week: number) {
  return `week:${path}:${week}`
}

export function materialFileSelectionKey(path: string) {
  return `file:${path}`
}

export function isMaterialPathInside(path: string, parentPath: string) {
  const normalizedPath = normalizedMaterialPath(path)
  const normalizedParent = normalizedMaterialPath(parentPath)
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`)
}

export function isPathOcrExcluded(
  targetPath: string,
  excludedPaths?: readonly string[] | null,
): { excluded: boolean; inherited: boolean } {
  if (!targetPath || !excludedPaths || excludedPaths.length === 0) {
    return { excluded: false, inherited: false }
  }
  const normTarget = targetPath.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")
  let directlyExcluded = false
  let inheritedExcluded = false
  for (const raw of excludedPaths) {
    const norm = String(raw || "").replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")
    if (!norm) continue
    if (normTarget === norm) {
      directlyExcluded = true
      break
    }
    if (normTarget.startsWith(`${norm}/`)) inheritedExcluded = true
  }
  if (directlyExcluded) return { excluded: true, inherited: false }
  if (inheritedExcluded) return { excluded: true, inherited: true }
  return { excluded: false, inherited: false }
}

function titleFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/")
  const fileName = normalized.split("/").pop() ?? ""
  return fileName.replace(/\.[^.]+$/, "")
}


function clampMenuPosition(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type UseMaterialsControllerOptions = {
  setNotice: (message: string) => void
}

export function useMaterialsController({ setNotice }: UseMaterialsControllerOptions) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const searchText = searchQuery.trim().toLowerCase()
  const { storedLectureMaterials, setLectureMaterials, refreshLectureMaterials } = useMaterialCatalog(setNotice)
  const [deletingFilePaths, setDeletingFilePaths] = useState<Set<string>>(() => new Set())
  const lectureMaterials = useMemo(
    () => hideDeletingMaterialFiles(storedLectureMaterials, deletingFilePaths),
    [storedLectureMaterials, deletingFilePaths],
  )
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(() => new Set())
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => new Set())
  const [selectedMaterialKeys, setSelectedMaterialKeys] = useState<Set<string>>(() => new Set())
  const [materialSelectionAnchor, setMaterialSelectionAnchor] = useState("")
  const [favoriteMaterialPaths, setFavoriteMaterialPaths] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("ails-favorite-materials")
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })
  const [materialContextMenu, setMaterialContextMenu] = useState<{
    x: number
    y: number
    target: MaterialContextTarget
  } | null>(null)
  const [materialFolderContextMenu, setMaterialFolderContextMenu] = useState<{
    x: number
    y: number
    target: MaterialFolderContextTarget
  } | null>(null)
  const [materialBulkContextMenu, setMaterialBulkContextMenu] = useState<{
    x: number
    y: number
    target: MaterialBulkDeleteTarget
  } | null>(null)
  const [materialTrashContextMenu, setMaterialTrashContextMenu] = useState<{
    x: number
    y: number
    target: MaterialTrashContextTarget
  } | null>(null)
  const [materialBaseContextMenu, setMaterialBaseContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [editingFolderPath, setEditingFolderPath] = useState("")
  const [editingFolderName, setEditingFolderName] = useState("")
  const [pendingFileDelete, setPendingFileDelete] = useState<MaterialContextTarget | null>(null)
  const [pendingFolderDelete, setPendingFolderDelete] = useState<MaterialFolderContextTarget | null>(null)
  const [pendingBulkDelete, setPendingBulkDelete] = useState<MaterialBulkDeleteTarget | null>(null)
  const [materialDropTargetPath, setMaterialDropTargetPath] = useState("")

  useEffect(() => {
    localStorage.setItem("ails-favorite-materials", JSON.stringify([...favoriteMaterialPaths]))
  }, [favoriteMaterialPaths])

  useEffect(() => {
    if (!materialContextMenu && !materialFolderContextMenu && !materialBulkContextMenu && !materialTrashContextMenu && !materialBaseContextMenu) return undefined
    const close = () => {
      setMaterialContextMenu(null)
      setMaterialFolderContextMenu(null)
      setMaterialBulkContextMenu(null)
      setMaterialTrashContextMenu(null)
      setMaterialBaseContextMenu(null)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    window.addEventListener("click", close)
    window.addEventListener("contextmenu", close)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("contextmenu", close)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [materialBaseContextMenu, materialBulkContextMenu, materialContextMenu, materialFolderContextMenu, materialTrashContextMenu])

  const filteredLectureMaterials = useMemo(() => {
    const folders = lectureMaterials?.folders ?? []
    if (!searchText) return folders

    const filterFolder = (folder: LectureMaterialFolder): LectureMaterialFolder | null => {
      const filteredFiles = folder.files.filter((file) =>
        `${folder.name} ${file.title} ${file.file_name} ${file.kind}`.toLowerCase().includes(searchText),
      )
      const filteredWeeks = folder.weeks
        .map((week) => ({
          ...week,
          reports: week.reports.filter((report) =>
            `${folder.name} ${week.week} ${report.title} ${report.file_name}`.toLowerCase().includes(searchText),
          ),
        }))
        .filter((week) => week.reports.length > 0)
      const filteredChildren = (folder.children ?? [])
        .map(filterFolder)
        .filter((child): child is LectureMaterialFolder => Boolean(child))
      const selfMatches = folder.name.toLowerCase().includes(searchText)
      if (!selfMatches && filteredWeeks.length === 0 && filteredFiles.length === 0 && filteredChildren.length === 0) {
        return null
      }
      return {
        ...folder,
        files: selfMatches ? folder.files : filteredFiles,
        weeks: selfMatches ? folder.weeks : filteredWeeks,
        children: selfMatches ? folder.children : filteredChildren,
      }
    }

    return folders
      .map(filterFolder)
      .filter((folder): folder is LectureMaterialFolder => Boolean(folder))
  }, [lectureMaterials, searchText])

  const learningMaterialGroups = useMemo(() => {
    const subjects: LectureMaterialFolder[] = []
    const archive: LectureMaterialFolder[] = []
    for (const folder of filteredLectureMaterials) {
      if (folder.is_virtual || folder.name.trim() === "보관함") {
        archive.push(folder.is_virtual ? { ...folder, name: t("기타 자료") } : folder)
        continue
      }
      subjects.push(folder)
    }
    return { subjects, archive }
  }, [filteredLectureMaterials])

  const visibleLearningMaterialFolders = useMemo(
    () => [...learningMaterialGroups.subjects, ...learningMaterialGroups.archive],
    [learningMaterialGroups],
  )

  const favoriteMaterialItems = useMemo(() => {
    const favoriteFolders: LectureMaterialFolder[] = []
    const favoriteFiles: { target: MaterialContextTarget; folderName: string }[] = []
    const seenFolderPaths = new Set<string>()
    const seenFilePaths = new Set<string>()

    const visit = (folder: LectureMaterialFolder) => {
      if (favoriteMaterialPaths.has(folder.path) && !folder.is_virtual && !seenFolderPaths.has(folder.path)) {
        seenFolderPaths.add(folder.path)
        favoriteFolders.push(folder)
      }
      for (const file of folder.files) {
        if (favoriteMaterialPaths.has(file.file_path) && !seenFilePaths.has(file.file_path)) {
          seenFilePaths.add(file.file_path)
          favoriteFiles.push({
            target: { path: file.file_path, fileName: file.file_name, title: file.title, kind: file.kind },
            folderName: folder.name,
          })
        }
      }
      for (const week of folder.weeks) {
        for (const report of week.reports) {
          if (favoriteMaterialPaths.has(report.file_path) && !seenFilePaths.has(report.file_path)) {
            seenFilePaths.add(report.file_path)
            favoriteFiles.push({
              target: { path: report.file_path, fileName: report.file_name, title: report.title, kind: "md" },
              folderName: folder.name,
            })
          }
        }
      }
      for (const child of folder.children ?? []) visit(child)
    }

    for (const folder of lectureMaterials?.folders ?? []) visit(folder)
    return { favoriteFolders, favoriteFiles }
  }, [lectureMaterials, favoriteMaterialPaths])

  const visibleMaterialSelectionItems = useMemo(() => {
    const items: MaterialSelectionItem[] = []

    const fileTargetFromMaterialFile = (file: LectureMaterialFile): MaterialContextTarget => ({
      path: file.file_path,
      fileName: file.file_name,
      title: file.title,
      kind: file.kind,
    })
    const fileTargetFromReport = (report: LectureMaterialReport): MaterialContextTarget => ({
      path: report.file_path,
      fileName: report.file_name,
      title: report.title,
      kind: "md",
    })
    const folderTargetFromFolder = (folder: LectureMaterialFolder): MaterialFolderContextTarget => ({
      path: folder.path,
      name: folder.name,
      weeks: folder.weeks.map((week) => week.week),
      reportCount: folder.report_count + folder.files.filter((file) => file.kind === "md").length,
      folder,
    })

    const visitFolder = (folder: LectureMaterialFolder) => {
      const folderOpen = expandedFolders.has(folder.path) || searchText.length > 0
      items.push({
        key: materialFolderSelectionKey(folder.path),
        label: folder.name,
        files: [],
        folder: folder.is_virtual ? undefined : folderTargetFromFolder(folder),
      })
      if (!folderOpen) return

      for (const child of folder.children ?? []) visitFolder(child)

      if (folder.files.length > 0) {
        for (const file of folder.files) {
          const target = fileTargetFromMaterialFile(file)
          items.push({ key: materialFileSelectionKey(file.file_path), label: file.title, files: [target] })
        }
      }

      for (const week of folder.weeks) {
        const weekKey = materialWeekSelectionKey(folder.path, week.week)
        const weekOpen = expandedWeeks.has(`${folder.path}:${week.week}`) || searchText.length > 0
        const files = week.reports.map(fileTargetFromReport)
        items.push({ key: weekKey, label: t("{p0}주차", { p0: week.week }), files })
        if (weekOpen) {
          for (const report of week.reports) {
            const target = fileTargetFromReport(report)
            items.push({ key: materialFileSelectionKey(report.file_path), label: report.title, files: [target] })
          }
        }
      }
    }

    for (const folder of visibleLearningMaterialFolders) visitFolder(folder)
    return items
  }, [expandedFolders, expandedWeeks, searchText, visibleLearningMaterialFolders])

  useEffect(() => {
    const visibleKeys = new Set(visibleMaterialSelectionItems.map((item) => item.key))
    setSelectedMaterialKeys((current) => {
      let changed = false
      const next = new Set<string>()
      for (const key of current) {
        if (visibleKeys.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : current
    })
    if (materialSelectionAnchor && !visibleKeys.has(materialSelectionAnchor)) setMaterialSelectionAnchor("")
  }, [materialSelectionAnchor, visibleMaterialSelectionItems])

  const closeContextMenus = useCallback(() => {
    setMaterialContextMenu(null)
    setMaterialFolderContextMenu(null)
    setMaterialBulkContextMenu(null)
    setMaterialTrashContextMenu(null)
    setMaterialBaseContextMenu(null)
  }, [])

  const toggleMaterialFavorite = useCallback((path: string) => {
    setFavoriteMaterialPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const toggleFolder = useCallback((folderKey: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderKey)) next.delete(folderKey)
      else next.add(folderKey)
      return next
    })
  }, [])

  const toggleWeek = useCallback((folderKey: string, week: number) => {
    const key = `${folderKey}:${week}`
    setExpandedWeeks((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  function getMaterialDeletionTargets(keys: Set<string>): MaterialBulkDeleteTarget {
    const selectedItems = visibleMaterialSelectionItems.filter((item) => keys.has(item.key))
    const folderCandidates = selectedItems
      .map((item) => item.folder)
      .filter((folder): folder is MaterialFolderContextTarget => Boolean(folder))
      .sort((left, right) => normalizedMaterialPath(left.path).length - normalizedMaterialPath(right.path).length)
    const folders: MaterialFolderContextTarget[] = []
    for (const folder of folderCandidates) {
      if (folders.some((selectedFolder) => isMaterialPathInside(folder.path, selectedFolder.path))) continue
      folders.push(folder)
    }
    const selectedFolderPaths = folders.map((folder) => folder.path)
    const filesByPath = new Map<string, MaterialContextTarget>()
    for (const item of selectedItems) {
      for (const file of item.files) {
        if (selectedFolderPaths.some((folderPath) => isMaterialPathInside(file.path, folderPath))) continue
        filesByPath.set(file.path, file)
      }
    }
    return { folders, files: Array.from(filesByPath.values()) }
  }

  function getMaterialDeleteCount(target: MaterialBulkDeleteTarget) {
    return target.files.length + target.folders.length
  }

  function handleMaterialSelectionClick(event: ReactMouseEvent, key: string) {
    const rangeSelection = event.shiftKey
    const toggleSelection = event.ctrlKey || event.metaKey
    if (!rangeSelection && !toggleSelection) {
      setSelectedMaterialKeys(new Set([key]))
      setMaterialSelectionAnchor(key)
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    const orderedKeys = visibleMaterialSelectionItems.map((item) => item.key)
    const clickedIndex = orderedKeys.indexOf(key)
    if (clickedIndex < 0) return true
    if (rangeSelection) {
      const anchorIndex = materialSelectionAnchor ? orderedKeys.indexOf(materialSelectionAnchor) : -1
      const startIndex = anchorIndex >= 0 ? Math.min(anchorIndex, clickedIndex) : clickedIndex
      const endIndex = anchorIndex >= 0 ? Math.max(anchorIndex, clickedIndex) : clickedIndex
      const rangeKeys = orderedKeys.slice(startIndex, endIndex + 1)
      setSelectedMaterialKeys((current) => {
        const next = toggleSelection ? new Set(current) : new Set<string>()
        for (const rangeKey of rangeKeys) next.add(rangeKey)
        return next
      })
      if (!materialSelectionAnchor) setMaterialSelectionAnchor(key)
      return true
    }
    setSelectedMaterialKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setMaterialSelectionAnchor(key)
    return true
  }

  function materialSelectionClass(key: string) {
    return selectedMaterialKeys.has(key) && "bg-[var(--brand-soft)] text-[var(--brand)] ring-1 ring-[var(--brand)]/30"
  }

  function openSelectedMaterialContextMenu(event: ReactMouseEvent, key: string) {
    const rightClickedSelected = selectedMaterialKeys.has(key)
    const keys = rightClickedSelected ? selectedMaterialKeys : new Set([key])
    const target = getMaterialDeletionTargets(keys)
    if (getMaterialDeleteCount(target) <= 0) return false
    if (!rightClickedSelected) {
      setSelectedMaterialKeys(new Set([key]))
      setMaterialSelectionAnchor(key)
    }
    if (rightClickedSelected && selectedMaterialKeys.size > 1 && getMaterialDeleteCount(target) > 1) {
      event.preventDefault()
      event.stopPropagation()
      closeContextMenus()
      setMaterialBulkContextMenu({
        x: clampMenuPosition(event.clientX, 8, window.innerWidth - 220),
        y: clampMenuPosition(event.clientY, 8, window.innerHeight - 96),
        target,
      })
      return true
    }
    return false
  }

  function openMaterialContextMenu(event: ReactMouseEvent, target: MaterialContextTarget, selectionKey?: string) {
    if (selectionKey && openSelectedMaterialContextMenu(event, selectionKey)) return
    if (selectionKey) {
      setSelectedMaterialKeys(new Set([selectionKey]))
      setMaterialSelectionAnchor(selectionKey)
    }
    event.preventDefault()
    event.stopPropagation()
    closeContextMenus()
    setMaterialContextMenu({
      x: clampMenuPosition(event.clientX, 8, window.innerWidth - 180),
      y: clampMenuPosition(event.clientY, 8, window.innerHeight - 96),
      target,
    })
  }

  function openMaterialFolderContextMenu(event: ReactMouseEvent, folder: LectureMaterialFolder, selectionKey?: string) {
    if (folder.is_virtual) return
    if (selectionKey && openSelectedMaterialContextMenu(event, selectionKey)) return
    if (selectionKey) {
      setSelectedMaterialKeys(new Set([selectionKey]))
      setMaterialSelectionAnchor(selectionKey)
    }
    event.preventDefault()
    event.stopPropagation()
    closeContextMenus()
    setMaterialFolderContextMenu({
      x: clampMenuPosition(event.clientX, 8, window.innerWidth - 220),
      y: clampMenuPosition(event.clientY, 8, window.innerHeight - 120),
      target: {
        path: folder.path,
        name: folder.name,
        weeks: folder.weeks.map((week) => week.week),
        reportCount: folder.report_count + folder.files.filter((file) => file.kind === "md").length,
        folder,
      },
    })
  }

  function openMaterialBaseContextMenu(event: ReactMouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    closeContextMenus()
    setMaterialBaseContextMenu({
      x: clampMenuPosition(event.clientX, 8, window.innerWidth - 180),
      y: clampMenuPosition(event.clientY, 8, window.innerHeight - 80),
    })
  }

  function openMaterialTrashContextMenu(event: ReactMouseEvent, item: LectureMaterialTrashItem) {
    event.preventDefault()
    event.stopPropagation()
    closeContextMenus()
    setMaterialTrashContextMenu({
      x: clampMenuPosition(event.clientX, 8, window.innerWidth - 180),
      y: clampMenuPosition(event.clientY, 8, window.innerHeight - 80),
      target: item,
    })
  }

  function handleMaterialDragStart(event: ReactDragEvent<HTMLElement>, filePath: string, title: string) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(MATERIAL_DRAG_MIME, filePath)
    event.dataTransfer.setData("text/plain", title)
  }

  function handleMaterialFolderDragStart(event: ReactDragEvent<HTMLElement>, folder: LectureMaterialFolder) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(MATERIAL_FOLDER_DRAG_MIME, folder.path)
    event.dataTransfer.setData("text/plain", folder.name)
  }

  async function createFolder(parentPath?: string) {
    const result = await createMaterialFolder({ parent_path: parentPath, name: t("새 폴더"), unique: true })
    setLectureMaterials(result.materials)
    setExpandedFolders((current) => new Set(current).add(result.folder.name))
    setEditingFolderPath(result.folder.path)
    setEditingFolderName(result.folder.name)
    return result
  }

  async function renameFolder(path: string, name: string) {
    const result = await renameMaterialFolder({ path, new_name: name })
    setLectureMaterials(result.materials)
    setExpandedFolders((current) => {
      const next = new Set(current)
      next.delete(titleFromPath(path))
      next.add(result.folder.name)
      return next
    })
    setEditingFolderPath("")
    setEditingFolderName("")
    return result
  }

  async function moveEntry(sourcePath: string, targetFolderPath: string) {
    const result = await moveMaterialEntry({ source_path: sourcePath, target_folder_path: targetFolderPath })
    setLectureMaterials(result.materials)
    return result
  }

  async function transferEntries(payload: MaterialTransferRequest) {
    const result = await transferMaterialEntries(payload)
    setLectureMaterials(result.materials)
    return result
  }

  async function moveFile(sourcePath: string, targetFolderPath: string) {
    const result = await moveMaterialFile({ source_path: sourcePath, target_folder_path: targetFolderPath })
    setLectureMaterials(result.materials)
    return result
  }

  async function renameFile(path: string, newName: string) {
    const result = await renameMaterialFile({ path, new_name: newName })
    await refreshLectureMaterials()
    return result
  }

  async function removeFile(target: MaterialContextTarget) {
    const path = normalizedMaterialPath(target.path)
    setDeletingFilePaths((current) => new Set(current).add(path))
    try {
      const result = await deleteMaterialFile({ path: target.path })
      setLectureMaterials(result.materials)
      setSelectedMaterialKeys((current) => {
        const next = new Set(current)
        next.delete(materialFileSelectionKey(result.path))
        return next
      })
      return result
    } finally {
      setDeletingFilePaths((current) => {
        const next = new Set(current)
        next.delete(path)
        return next
      })
    }
  }

  async function removeFolder(target: MaterialFolderContextTarget) {
    const result = await deleteMaterialFolder({ path: target.path })
    setLectureMaterials(result.materials)
    setSelectedMaterialKeys((current) => {
      const next = new Set(current)
      for (const key of current) {
        if (key === materialFolderSelectionKey(result.path) || key.includes(result.path)) next.delete(key)
      }
      return next
    })
    if (editingFolderPath === result.path) {
      setEditingFolderPath("")
      setEditingFolderName("")
    }
    return result
  }

  async function removeBulk(target: MaterialBulkDeleteTarget) {
    let latestMaterials: LectureMaterialsPayload | null = null
    const removedPaths: string[] = []
    for (const folder of target.folders) {
      const result = await deleteMaterialFolder({ path: folder.path })
      latestMaterials = result.materials
      removedPaths.push(result.path)
    }
    for (const file of target.files) {
      const result = await deleteMaterialFile({ path: file.path })
      latestMaterials = result.materials
      removedPaths.push(result.path)
    }
    if (latestMaterials) setLectureMaterials(latestMaterials)
    setSelectedMaterialKeys(new Set())
    setMaterialSelectionAnchor("")
    return removedPaths
  }

  async function removeTrashItem(target: MaterialTrashContextTarget) {
    const result = await deleteMaterialTrashItem({ path: target.path })
    setLectureMaterials(result.materials)
    return result
  }

  function toggleSearch() {
    setSearchOpen((current) => !current)
    setNotice(searchOpen ? t("검색을 닫았습니다.") : t("검색을 열었습니다."))
  }

  return {
    actions: {
      createFolder,
      loadFile: getMaterialFile,
      moveEntry,
      transferEntries,
      moveFile,
      refreshLectureMaterials,
      removeBulk,
      removeFile,
      removeFolder,
      removeTrashItem,
      renameFile,
      renameFolder,
    },
    data: {
      favoriteMaterialItems,
      favoriteMaterialPaths,
      learningMaterialGroups,
      lectureMaterials,
      pendingFileDeletes: deletingFilePaths,
      setLectureMaterials,
      visibleLearningMaterialFolders,
    },
    editing: {
      editingFolderName,
      editingFolderPath,
      setEditingFolderName,
      setEditingFolderPath,
    },
    menus: {
      closeContextMenus,
      materialBaseContextMenu,
      materialBulkContextMenu,
      materialContextMenu,
      materialFolderContextMenu,
      materialTrashContextMenu,
      openMaterialBaseContextMenu,
      openMaterialContextMenu,
      openMaterialFolderContextMenu,
      openMaterialTrashContextMenu,
      setMaterialBaseContextMenu,
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
    search: {
      open: searchOpen,
      query: searchQuery,
      setQuery: setSearchQuery,
      text: searchText,
      toggle: toggleSearch,
    },
    selection: {
      getMaterialDeleteCount,
      handleMaterialSelectionClick,
      materialSelectionAnchor,
      materialSelectionClass,
      openSelectedMaterialContextMenu,
      selectedMaterialKeys,
      setSelectedMaterialKeys,
      visibleMaterialSelectionItems,
    },
    tree: {
      expandedFiles,
      expandedFolders,
      expandedWeeks,
      handleMaterialDragStart,
      handleMaterialFolderDragStart,
      materialDropTargetPath,
      setExpandedFiles,
      setMaterialDropTargetPath,
      toggleFolder,
      toggleMaterialFavorite,
      toggleWeek,
    },
  }
}

export type MaterialsController = ReturnType<typeof useMaterialsController>
