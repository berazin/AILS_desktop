import { t } from "../../../lib/i18n.ts"
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState, useMemo } from "react"
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  FileText,
  FileVideo,
  Folder,
  Info,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pin,
  RotateCw,
  Sparkles,
} from "lucide-react"

import { Button } from "../../../shared/ui/button.tsx"
import { StudyCardCover } from "./study-card-cover.tsx"
import { MaterialProblemProgress } from "./material-problem-progress.tsx"
import { DocumentDetailModal } from "./document-detail-modal.tsx"
import { FileInspectorPanel } from "./file-inspector-panel.tsx"
import "./processbar-scroll.css"
import { MaterialContextMenu } from "./material-context-menu.tsx"
import { renamedWorkspacePath, type WorkspaceRenameAction } from "../lib/workspace-rename.ts"
import { WorkspaceInlineRename } from "./workspace-inline-rename.tsx"
import { contextDeleteTarget, uniqueContextItems, workspaceContextItems, type MaterialContextMenuState } from "../lib/material-context-targets.ts"
import type { MaterialBulkDeleteTarget } from "../../materials/hooks/use-materials-controller.ts"
import { HomeDashboardActions } from "./home-dashboard-actions.tsx"
import { HomeRecentFilesMenu } from "./home-recent-files-menu.tsx"
import { HomeFavoritesMenu, type HomeFavoriteItem } from "./home-favorites-menu.tsx"
import { HomeFavoritesNavigation } from "./home-favorites-navigation.tsx"
import { HomeWorkspacePathBar } from "./home-workspace-path-bar.tsx"
import { useWorkspacePins, workspacePinKey } from "../hooks/use-workspace-pins.ts"
import { useWorkspaceSelection, type WorkspaceSelectionModifiers } from "../hooks/use-workspace-selection.ts"
import { useWorkspaceClipboard } from "../hooks/use-workspace-clipboard.ts"
import type { MaterialTransferRequest, MaterialTransferResult } from "../../../lib/api/materials.ts"
import { useWorkspaceInlineRenaming } from "../hooks/use-workspace-inline-renaming.ts"
import { useWorkspaceMarquee } from "../hooks/use-workspace-marquee.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { WorkspaceBackgroundMenu } from "./workspace-background-menu.tsx"
import type { CreatedWorkspaceEntry, WorkspaceEntryKind } from "../../materials/hooks/use-workspace-entry-creation.ts"
import { HomeRecentFilesDialog } from "./home-recent-files-dialog.tsx"
import {
  type LectureMaterialFolder,
  type LectureMaterialsPayload,
} from "../../../lib/api"
import type { MaterialContextTarget } from "../../../lib/material-navigation.ts"
import {
  useMaterialsListing,
  type MaterialItem,
  type MaterialSortOption as SortOption,
} from "../hooks/use-materials-listing.ts"
import { HOME_MATERIAL_CARD_HEIGHT, HOME_MATERIAL_ROW_HEIGHT, useHomeGridWindow, useHomeMaterialWindow, useHomeMaterialFocus } from "../hooks/use-home-material-window.ts"
import { useHomeScrollRestoration } from "../hooks/use-home-scroll-restoration.ts"
import { useProcessbarScrollProximity } from "../hooks/use-processbar-scroll-proximity.ts"
import { useWorkspaceListColumns } from "../../../shared/hooks/use-workspace-list-columns.ts"

import type { DashboardRecentFile } from "../../../shared/workspace-types.ts"
import type { DocumentDetailOcrJob } from "../lib/document-detail-presentation.ts"

export type { DashboardRecentFile }


export { HomeAgentWorkspace } from "./home-agent-workspace.tsx"

export type HomeQuickActions = {
  openWorkQueue: () => void
  openCode: () => void
  openFile: (path: string) => void
  openFolder: () => void
  openHelp: () => void
  openPractice: () => void
  openSettings: () => void
  openSummary: () => void
  openChatbot: () => void
  runOcr: (path: string) => void
  runTranslation: (path: string) => void
}

type LearningDashboardProps = {
  workspaceOnly?: boolean
  folderPath?: string
  onNavigateFolder?: (path: string) => void
  onCreateEntry?: (parentPath: string, kind: WorkspaceEntryKind) => Promise<CreatedWorkspaceEntry>
  accountKey?: string
  quickActions: HomeQuickActions
  mdSavePath: string
  recentFiles: DashboardRecentFile[]
  searchContent?: ReactNode
  favoritePaths?: ReadonlySet<string>
  favoriteEntries?: HomeFavoriteItem[]
  onToggleFavorite?: (path: string) => void
  refreshing: boolean
  onBackToAgent: () => void
  onMoveToTrash: (path: string) => void
  onMoveSelectionToTrash?: (target: MaterialBulkDeleteTarget) => void
  onTransferEntries?: (payload: MaterialTransferRequest) => Promise<MaterialTransferResult>
  onOpenRecent: (path: string) => void
  onRefresh: () => void
  isOpeningRecent: (path: string) => boolean
  pdfPageByDocument?: Record<string, number>
  activeOcrJobs?: readonly DocumentDetailOcrJob[]
  lectureMaterials?: LectureMaterialsPayload | null
  onOpenAtPage?: (path: string, page: number) => void
  onDocumentMetaChanged?: () => void
  documentTags?: Record<string, string[]>
  onRenameFile?: WorkspaceRenameAction
  onToggleOcrExclusion?: (path: string) => void
  onSetOcrExclusions?: (paths: readonly string[], excluded: boolean) => void | Promise<void>
  onGenerateFilePractice?: (target: MaterialContextTarget) => void
  onSolvePractice?: (path: string) => void
  ocrExcludedPaths?: string[]
}

/* ─────────────────────────────────────────────────────────────────
   학습 자료 대시보드
───────────────────────────────────────────────────────────────── */
export function LearningDashboard({
  workspaceOnly = false,
  folderPath,
  onNavigateFolder,
  onCreateEntry,
  accountKey = "",
  quickActions,
  mdSavePath,
  recentFiles,
  searchContent,
  favoritePaths,
  favoriteEntries,
  onToggleFavorite,
  refreshing,
  onBackToAgent,
  onMoveToTrash,
  onMoveSelectionToTrash,
  onTransferEntries,
  onOpenRecent,
  onRefresh,
  isOpeningRecent,
  pdfPageByDocument,
  activeOcrJobs,
  lectureMaterials,
  onOpenAtPage,
  onDocumentMetaChanged,
  documentTags,
  onRenameFile,
  onToggleOcrExclusion,
  onSetOcrExclusions,
  onGenerateFilePractice,
  onSolvePractice,
  ocrExcludedPaths,
}: LearningDashboardProps) {
  const SORT_OPTIONS: { key: SortOption; label: string }[] = [
    { key: "updated_desc", label: t("최근 수정순") },
    { key: "updated_asc", label: t("오래된 수정순") },
    { key: "name_asc", label: t("이름 오름차순 (ㄱ-ㅎ)") },
    { key: "name_desc", label: t("이름 내림차순 (ㅎ-ㄱ)") },
    { key: "kind_asc", label: t("유형순") },
  ]

  const sortDropdownRef = useRef<HTMLDivElement>(null)
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    try {
      const saved = localStorage.getItem("ails-home-view-mode")
      if (saved === "list" || saved === "grid") return saved
    } catch {
      void 0
    }
    return "list"
  })
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    try {
      const saved = localStorage.getItem("ails-home-sort-option")
      if (saved && ["updated_desc", "updated_asc", "name_asc", "name_desc", "kind_asc"].includes(saved)) {
        return saved as SortOption
      }
    } catch {
      void 0
    }
    return "updated_desc"
  })
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [recentFilesOpen, setRecentFilesOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<"info" | "pages" | "tools">("info")
  const [localFolderPath, setLocalFolderPath] = useState("")
  const currentFolderPath = folderPath ?? localFolderPath
  const materialScrollRef = useRef<HTMLDivElement>(null)
  const materialBodyRef = useRef<HTMLTableSectionElement>(null)
  const materialGridRef = useRef<HTMLDivElement>(null)
  const materialListRef = useRef<HTMLDivElement>(null)
  const listColumns = useWorkspaceListColumns(materialListRef, viewMode === "list")
  useHomeScrollRestoration(materialScrollRef)
  useProcessbarScrollProximity(materialScrollRef)

  const { pinnedPaths, togglePin: toggleWorkspacePin } = useWorkspacePins()
  const [hiddenRecentPaths, setHiddenRecentPaths] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("ails-hidden-recent-files")
      return saved ? (JSON.parse(saved) as string[]) : []
    } catch {
      return []
    }
  })
  const [materialMenu, setMaterialMenu] = useState<MaterialContextMenuState | null>(null)
  const [materialActionError, setMaterialActionError] = useState("")
  const [renameFocusPath, setRenameFocusPath] = useState("")
  const inlineRename = useWorkspaceInlineRenaming(prepareInlineRename)
  const inlineRenamePath = inlineRename.activePath

  const togglePin = (path: string) => {
    toggleWorkspacePin(path)
    if (materialScrollRef.current) materialScrollRef.current.scrollTop = 0
  }

  const hideFromRecent = (path: string) => {
    setHiddenRecentPaths((prev) => {
      const next = prev.includes(path) ? prev : [...prev, path]
      try {
        localStorage.setItem("ails-hidden-recent-files", JSON.stringify(next))
      } catch {
        void 0
      }
      return next
    })
  }

  // 모든 자료 섹션에서 공용으로 쓰는 더보기 메뉴. 3점 버튼 클릭과 우클릭 모두 이 메뉴를 연다.
  function resolveMaterialItem(item: MaterialItem): MaterialItem {
    const matched = allMaterials.find((m) => m.path === item.path)
    return matched ? { ...matched, ...item } : item
  }

  function openMaterialMenu(event: ReactMouseEvent, item: MaterialItem, items?: MaterialItem[]) {
    event.preventDefault()
    event.stopPropagation()
    setSortDropdownOpen(false)
    setMaterialActionError("")
    setMaterialMenu({
      item: resolveMaterialItem(item),
      items: items?.map(resolveMaterialItem),
      x: Math.min(Math.max(event.clientX, 8), window.innerWidth - 248),
      y: Math.min(Math.max(event.clientY, 8), window.innerHeight - 420),
    })
  }

  // 심층 상세 정보 모달 상태
  const [details, setDetails] = useState<{ items: MaterialItem[]; index: number } | null>(null)
  const detailedModalItem = details?.items[details.index] ?? null

  const handleSetViewMode = (mode: "list" | "grid") => {
    setViewMode(mode)
    try {
      localStorage.setItem("ails-home-view-mode", mode)
    } catch {
      void 0
    }
  }

  const handleSetSortOption = (opt: SortOption) => {
    setSortOption(opt)
    try {
      localStorage.setItem("ails-home-sort-option", opt)
    } catch {
      void 0
    }
    setSortDropdownOpen(false)
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false)
      }
    }
    if (sortDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [sortDropdownOpen])

  const { studyCards, allMaterials, sortedMaterials, currentFolderTitle } = useMaterialsListing({
    lectureMaterials,
    searchQuery: "",
    currentFolderPath,
    recentFiles,
    pdfPageByDocument,
    documentTags,
    sortOption,
    pinnedPaths,
    hiddenRecentPaths,
    recentLimit: Infinity,
  })
  const materialRows = useHomeMaterialWindow(sortedMaterials.length, materialScrollRef, materialBodyRef, viewMode === "list", currentFolderPath)
  const selectionPaths = useMemo(() => sortedMaterials.map((item) => item.path), [sortedMaterials])
  const workspaceSelection = useWorkspaceSelection(selectionPaths)
  const [pasteFocusPath, setPasteFocusPath] = useState("")
  const workspaceRoot = lectureMaterials?.base_path || mdSavePath
  const workspaceClipboard = useWorkspaceClipboard({ root: workspaceRoot, folder: currentFolderPath || workspaceRoot,
    selectedPaths: workspaceSelection.selectedPaths, renameActive: inlineRename.total > 0, onTransfer: onTransferEntries,
    onError: setMaterialActionError, onPasted: (folder, paths) => {
      if (workspacePinKey(folder) !== workspacePinKey(currentFolderPath || workspaceRoot) || !paths.length) return
      workspaceSelection.selectTransferredPaths(paths)
      setPasteFocusPath(paths[0])
    } })
  const materialGrid = useHomeGridWindow(sortedMaterials.length, materialScrollRef, materialGridRef, viewMode === "grid", currentFolderPath)
  useHomeMaterialFocus(pasteFocusPath, selectionPaths, materialScrollRef, viewMode === "grid" ? materialGridRef : materialBodyRef,
    viewMode === "grid", () => setPasteFocusPath(""))
  useHomeMaterialFocus(renameFocusPath, selectionPaths, materialScrollRef, viewMode === "grid" ? materialGridRef : materialBodyRef,
    viewMode === "grid", () => { inlineRename.activate(renameFocusPath); setRenameFocusPath("") })

  const [selectedItemId, setSelectedItemId] = useState<string>("")
  const marquee = useWorkspaceMarquee({ scrollRef: materialScrollRef, paths: selectionPaths,
    selectedPaths: workspaceSelection.selectedPaths, anchor: workspaceSelection.anchor,
    viewMode, folderPath: currentFolderPath, onSelect: workspaceSelection.replace,
    onBegin: () => { setSelectedItemId(""); setInspectorOpen(false); setMaterialMenu(null); setSortDropdownOpen(false) } })
  const selectedItem = useMemo(() => {
    if (selectedItemId) {
      const found = sortedMaterials.find((item) => item.id === selectedItemId || item.path === selectedItemId)
      if (found) return found
      const recent = studyCards.find((item) => item.id === selectedItemId || item.path === selectedItemId)
      if (recent) return recent
    }
    return null
  }, [sortedMaterials, studyCards, selectedItemId])
  const selectedPracticeSet = useMemo(() => {
    if (!selectedItem || selectedItem.kind !== "MD") return null
    const pending: LectureMaterialFolder[] = [...(lectureMaterials?.folders ?? [])]
    while (pending.length) {
      const folder = pending.pop()!
      const file = folder.files.find((item) => item.file_path === selectedItem.path)
      if (file) return file.practice_set ?? null
      const report = folder.weeks.flatMap((week) => week.reports).find((item) => item.file_path === selectedItem.path)
      if (report) return report.practice_set ?? null
      pending.push(...(folder.children ?? []))
    }
    return null
  }, [lectureMaterials, selectedItem])
  const favoriteItems = new Set([...allMaterials, ...studyCards].filter((item) => favoritePaths?.has(item.path)).map((item) => item.id))
  const toggleFavorite = (id: string) => {
    const item = allMaterials.find((entry) => entry.id === id) ?? studyCards.find((entry) => entry.id === id)
    if (item) onToggleFavorite?.(item.path)
  }

  function openMaterial(item: MaterialItem) {
    if (item.kind === "folder") navigateToFolder(item.path)
    else if (!isOpeningRecent(item.path)) onOpenRecent(item.path)
  }

  function clearWorkspaceSelection() {
    workspaceSelection.clear()
    setSelectedItemId("")
    setInspectorOpen(false)
  }

  function navigateToFolder(path: string) {
    inlineRename.cancel()
    setRenameFocusPath("")
    clearWorkspaceSelection()
    setPasteFocusPath("")
    materialScrollRef.current?.focus({ preventScroll: true })
    if (onNavigateFolder) onNavigateFolder(path)
    else setLocalFolderPath(path)
  }

  const resetFolderSelection = useEventCallback(clearWorkspaceSelection)
  const previousFolderPath = useRef(currentFolderPath)
  useEffect(() => {
    if (previousFolderPath.current === currentFolderPath) return
    previousFolderPath.current = currentFolderPath
    resetFolderSelection()
  }, [currentFolderPath, resetFolderSelection])

  function selectWorkspaceMaterial(item: MaterialItem, modifiers: WorkspaceSelectionModifiers = {}) {
    workspaceSelection.select(item.path, modifiers)
    setSelectedItemId(item.path)
    const showInfo = !workspaceOnly && !(modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey)
    setInspectorOpen(showInfo)
    if (showInfo) setInspectorTab("info")
  }

  function openWorkspaceMaterial(event: ReactMouseEvent, item: MaterialItem) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || (event.target as Element).closest("button")) return
    openMaterial(item)
  }

  function openWorkspaceMenu(event: ReactMouseEvent, item: MaterialItem) {
    const items = workspaceContextItems(item, workspaceSelection.selectedPaths, sortedMaterials)
    if (!workspaceSelection.selectedPaths.has(item.path)) selectWorkspaceMaterial(item)
    openMaterialMenu(event, item, items)
  }

  function selectMaterial(item: MaterialItem) {
    workspaceSelection.select(item.path)
    setSelectedItemId(item.path)
    setInspectorTab("info")
    setInspectorOpen(true)
  }

  function prepareInlineRename(item: MaterialItem) {
    setMaterialMenu(null); setSortDropdownOpen(false)
    setSelectedItemId(item.path)
    setRenameFocusPath(item.path)
  }

  function startInlineRename(items: readonly MaterialItem[]) {
    if (!onRenameFile) return
    const targets = uniqueContextItems(items), first = targets[0]
    if (!first) return
    const root = lectureMaterials?.base_path || mdSavePath
    if (targets.some(item => !workspacePinKey(item.path).startsWith(workspacePinKey(root) + "/"))) {
      setMaterialActionError(t("작업공간 안의 항목만 이름을 변경할 수 있습니다.")); return
    }
    if (!sortedMaterials.some(item => workspacePinKey(item.path) === workspacePinKey(first.path))) {
      const parent = first.path.replace(/[\\/][^\\/]+$/, "")
      const folder = workspacePinKey(parent) === workspacePinKey(root) ? "" : parent
      clearWorkspaceSelection()
      if (onNavigateFolder) onNavigateFolder(folder)
      else setLocalFolderPath(folder)
    }
    if (targets.length === 1) workspaceSelection.select(first.path)
    setRecentFilesOpen(false); setMaterialActionError("")
    inlineRename.start(targets)
  }

  const finishInlineRename = useEventCallback((oldPath: string, newPath: string, focus: boolean, cancelled: boolean = false) => {
    workspaceSelection.renamePath(oldPath, newPath)
    setSelectedItemId(current => renamedWorkspacePath(current, oldPath, newPath))
    const advanced = inlineRename.finish(oldPath, newPath, focus, cancelled)
    if (advanced === false && focus) setRenameFocusPath(newPath)
  })

  const onEntryCreated = useEventCallback((entry: CreatedWorkspaceEntry, parentPath: string) => {
    if ((currentFolderPath || lectureMaterials?.base_path || mdSavePath) !== parentPath) return
    workspaceSelection.select(entry.path)
    setSelectedItemId(entry.path)
  })

  return (
    <section
      className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-[#f8f9fd] text-slate-900 dark:bg-[#0c0e14] dark:text-white"
      data-ails-dashboard-surface="true"
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!workspaceOnly && <HomeWorkspacePathBar key={`${lectureMaterials?.base_path || mdSavePath}:${currentFolderPath}`}
          rootPath={lectureMaterials?.base_path || mdSavePath} folderPath={currentFolderPath} folders={lectureMaterials?.folders ?? []} onNavigate={navigateToFolder} />}
        {!workspaceOnly && <HomeDashboardActions accountKey={accountKey} quickActions={quickActions} mdSavePath={mdSavePath} onOpenSource={onOpenRecent} searchContent={searchContent}
          recentFiles={<HomeRecentFilesMenu items={studyCards} onShowAll={() => setRecentFilesOpen(true)} onOpen={onOpenRecent} onMenu={openMaterialMenu} isOpening={isOpeningRecent} />}
          favorites={<HomeFavoritesMenu items={favoriteEntries ?? []} onOpen={(item) => { if (item.kind === "folder") navigateToFolder(item.path); else onOpenRecent(item.path) }} onRemove={(path) => onToggleFavorite?.(path)} />} />}
        <div className="flex min-h-0 min-w-0 flex-1">
        {!workspaceOnly && <HomeFavoritesNavigation items={favoriteEntries ?? []} rootPath={lectureMaterials?.base_path || mdSavePath} folderPath={currentFolderPath}
          onNavigate={navigateToFolder} onOpen={onOpenRecent} onRemove={(path) => onToggleFavorite?.(path)} isOpening={isOpeningRecent} />}
        <WorkspaceBackgroundMenu parentPath={currentFolderPath || lectureMaterials?.base_path || mdSavePath} onCreate={onCreateEntry} onCreated={onEntryCreated}
          onOpen={() => { clearWorkspaceSelection(); setMaterialMenu(null); setSortDropdownOpen(false) }}>
        <div className={`flex min-h-0 flex-1 ${workspaceOnly ? "p-4" : "px-6 pb-6 pt-4"}`}>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t("작업공간")} data-ails-workspace-files="true" aria-busy={workspaceClipboard.busy || undefined}
            data-ails-workspace-rename-session={inlineRename.total > 0 ? "true" : undefined} onKeyDownCapture={event => {
            if (workspaceClipboard.onKeyDown(event)) return
            const target = event.target as HTMLElement
            if (event.key === "Escape" && inlineRename.pending) {
              event.preventDefault(); event.stopPropagation(); inlineRename.cancel(); setRenameFocusPath(""); return
            }
            if ((event.key !== "F2" && event.key !== "Delete") || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat
              || event.nativeEvent.isComposing || target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")
              || inlineRename.total > 0 || workspaceSelection.selectedPaths.size === 0) return
            const items = sortedMaterials.filter(candidate => workspaceSelection.selectedPaths.has(candidate.path))
            if (!items.length) return
            if (event.key === "Delete") {
              event.preventDefault(); event.stopPropagation()
              setMaterialMenu(null); setSortDropdownOpen(false); setMaterialActionError("")
              try {
                if (onMoveSelectionToTrash) onMoveSelectionToTrash(contextDeleteTarget(items, lectureMaterials))
                else if (items.length === 1) onMoveToTrash(items[0].path)
                else setMaterialActionError(t("여러 파일 삭제를 사용할 수 없습니다."))
              } catch (error) {
                setMaterialActionError(error instanceof Error ? error.message : String(error))
              }
              return
            }
            if (!onRenameFile) return
            event.preventDefault(); event.stopPropagation()
            startInlineRename(items)
          }}>
            <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 pb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="shrink-0 text-sm font-bold">{t("작업공간")}</h2>
                  {inlineRename.total > 1 && <span className="text-xs text-slate-500" role="status">{t("이름 변경 {p0}/{p1}", { p0: inlineRename.index + 1, p1: inlineRename.total })}</span>}
                </div>
                {currentFolderPath && <p className="mt-0.5 max-w-60 truncate text-xs text-slate-400 dark:text-white/40" title={currentFolderPath}>{currentFolderTitle}</p>}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={t("그리드 보기")} aria-pressed={viewMode === "grid"} className={`rounded p-1.5 hover:bg-slate-100 dark:hover:bg-white/10 ${viewMode === "grid" ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`} onClick={() => handleSetViewMode("grid")}><LayoutGrid size={15} /></button>
                  <button type="button" aria-label={t("목록 보기")} aria-pressed={viewMode === "list"} className={`rounded p-1.5 hover:bg-slate-100 dark:hover:bg-white/10 ${viewMode === "list" ? "text-blue-600 dark:text-blue-400" : "text-slate-400"}`} onClick={() => handleSetViewMode("list")}><List size={15} /></button>
                </div>
                <div className="relative" ref={sortDropdownRef}>
                  <button
                    aria-label={t("정렬 방식")}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs text-slate-600 shadow-xs hover:bg-slate-50 dark:border-white/[0.1] dark:bg-[#141722] dark:text-white/70"
                    onClick={() => setSortDropdownOpen((prev) => !prev)}
                    type="button"
                  >
                    <span className="max-w-28 truncate">
                      {SORT_OPTIONS.find((opt) => opt.key === sortOption)?.label || t("최근 수정순")}
                    </span>
                    <ChevronDown
                      size={13}
                      className={`transition-transform duration-200 ${sortDropdownOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {sortDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1.5 z-40 w-44 rounded-xl border border-slate-200/90 bg-white p-1 shadow-lg dark:border-white/[0.1] dark:bg-[#181c2b]">
                      {SORT_OPTIONS.map((opt) => {
                        const isSelected = opt.key === sortOption
                        return (
                          <button
                            key={opt.key}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                              isSelected
                                ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/[0.06] dark:hover:text-white"
                            }`}
                            onClick={() => handleSetSortOption(opt.key)}
                            type="button"
                          >
                            <span>{opt.label}</span>
                            {isSelected && <Check size={13} className="text-blue-600 dark:text-blue-400" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <Button className="gap-1.5 rounded-xl bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-black/80!" onClick={onRefresh} size="sm" aria-label={t("목록 갱신")} title={t("목록 갱신")}>
                  <RotateCw size={13} className={refreshing ? "animate-spin" : ""} /><span className="hidden xl:inline">{t("목록 갱신")}</span>
                </Button>
              </div>
            </header>
            {materialActionError && <p role="alert" className="mb-2 whitespace-pre-line text-xs text-red-600">{materialActionError}</p>}
            {workspaceClipboard.notice && <p role="status" className="mb-2 text-xs text-slate-500">{workspaceClipboard.notice}</p>}
            <div ref={materialScrollRef} className="relative min-h-0 flex-1 overflow-y-auto ails-processbar-scroll" data-ails-home-workspace-scroll="true" data-ails-quick-chat-focus-surface="true" data-ails-workspace-selection-count={workspaceSelection.selectedPaths.size} tabIndex={0}
              onPointerDown={marquee.onPointerDown} onClickCapture={marquee.onClickCapture} onDoubleClickCapture={marquee.onDoubleClickCapture} onKeyDown={(event) => {
              if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a" || event.altKey || event.shiftKey || event.nativeEvent.isComposing) return
              const target = event.target as HTMLElement
              if (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .monaco-editor")) return
              event.preventDefault()
              event.stopPropagation()
              workspaceSelection.selectAll()
              setSelectedItemId("")
              setInspectorOpen(false)
            }} onClick={(event) => {
              if (!(event.target as Element).closest("[data-ails-workspace-item], button, [role='button'], th")) {
                event.currentTarget.focus({ preventScroll: true })
                clearWorkspaceSelection()
              }
            }}>
              {/* 뷰 모드에 따른 그리드 / 리스트 렌더링 */}
              {viewMode === "grid" ? (
                <div className="pt-1">
                  {sortedMaterials.length === 0 ? (
                    <div className="p-12 text-center text-xs text-slate-400 dark:text-white/40">
                      {lectureMaterials == null ? t("자료 목록을 준비 중입니다.") : t("작업공간에 학습 자료가 없습니다.")}
                    </div>
                  ) : (
                    <div ref={materialGridRef} className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
                      {materialGrid.top > 0 && <div aria-hidden="true" style={{ gridColumn: "1 / -1", height: materialGrid.top }} />}
                      {sortedMaterials.slice(materialGrid.start, materialGrid.end).map((item, index) => {
                        const isSelected = workspaceSelection.selectedPaths.has(item.path)
                        const isFolder = item.kind === "folder"

                        return (
                          <div
                            key={item.id}
                            style={{ height: HOME_MATERIAL_CARD_HEIGHT }}
                            className={`group relative flex select-none flex-col justify-between p-4 transition-colors cursor-default ${workspaceClipboard.isCut(item.path) ? "opacity-50" : ""} ${
                              isSelected
                                ? "bg-blue-100 hover:bg-blue-200/70 dark:bg-blue-900/50 dark:hover:bg-blue-900/70"
                                : "hover:bg-blue-50 dark:hover:bg-blue-500/10"
                            }`}
                            data-ails-workspace-item={item.path}
                            data-ails-workspace-cut={workspaceClipboard.isCut(item.path) || undefined}
                            data-ails-workspace-index={materialGrid.start + index}
                            aria-pressed={isSelected}
                            onClick={(event) => selectWorkspaceMaterial(item, event)}
                            onDoubleClick={(event) => openWorkspaceMaterial(event, item)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return
                              if (event.key === "Enter") { event.preventDefault(); openMaterial(item) }
                              else if (event.key === " ") { event.preventDefault(); selectWorkspaceMaterial(item, event) }
                              else if (event.key === "Escape") clearWorkspaceSelection()
                            }}
                            onContextMenu={(e) => openWorkspaceMenu(e, item)}
                            role="button"
                            tabIndex={0}
                          >
                            {!workspaceOnly && <button type="button" className="absolute left-5 top-5 z-10 rounded bg-white/90 p-1.5 text-slate-500 hover:text-blue-600 dark:bg-[#131622]/90 dark:text-white/60" aria-label={`${item.title} ${t("정보 보기")}`} onClick={(event) => { event.stopPropagation(); selectMaterial(item) }}><Info size={14} /></button>}
                            {/* 상단 썸네일 / 폴더 아이콘 */}
                            {isFolder ? (
                              <div className="flex h-48 w-full items-center justify-center">
                                <Folder className="h-16 w-16 text-blue-500/90 fill-blue-500/20 drop-shadow-sm" />
                              </div>
                            ) : (
                              <div className="flex justify-center py-1">
                                <StudyCardCover
                                  card={item}
                                  className="h-48 w-34 shadow-md rounded-xl"
                                  lastPage={item.lastPage || 1}
                                />
                              </div>
                            )}

                            {/* 메타 정보 */}
                            <div className="mt-3 flex min-w-0 flex-1 flex-col justify-between">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  {isFolder ? (
                                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                                      {t("폴더")}
                                    </span>
                                  ) : item.kind === "MD" ? (
                                    <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold text-teal-600 dark:bg-teal-950/50 dark:text-teal-400">
                                      {t("정리본")}
                                    </span>
                                  ) : item.kind === "EPUB" ? (
                                    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold text-violet-600 dark:bg-violet-950/50 dark:text-violet-400">
                                      EPUB
                                    </span>
                                  ) : (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 dark:bg-white/[0.06] dark:text-white/60">
                                      {item.kind}
                                    </span>
                                  )}
                                  {item.lastPage && !isFolder && item.kind !== "EPUB" && (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] font-medium text-slate-500 dark:bg-white/[0.06] dark:text-white/50">
                                      p.{item.lastPage}
                                    </span>
                                  )}
                                  <MaterialProblemProgress solved={item.solvedProblemCount} total={item.problemCount} />
                                </div>

                                {inlineRenamePath === item.path && onRenameFile ? <WorkspaceInlineRename key={item.path} item={item} onRename={onRenameFile}
                                  onFinish={finishInlineRename} onError={setMaterialActionError} className="mt-1.5" /> : <h3
                                  className="mt-1.5 truncate text-xs font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400 break-keep"
                                  title={item.title}
                                >
                                  {item.title}
                                  {item.isPinned && <Pin size={11} className="ml-1 inline-block text-[var(--brand)]" aria-label={t("상단 고정됨")} />}
                                </h3>}
                              </div>

                              <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-400 dark:text-white/40">
                                <span>{isFolder ? item.itemCount === undefined ? "—" : `${item.itemCount}개 항목` : item.date}</span>
                                <button
                                  className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                                  onClick={(e) => openWorkspaceMenu(e, item)}
                                  onContextMenu={(e) => openWorkspaceMenu(e, item)}
                                  title={t("더보기")}
                                  type="button"
                                >
                                  <MoreHorizontal size={13} />
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {materialGrid.bottom > 0 && <div aria-hidden="true" style={{ gridColumn: "1 / -1", height: materialGrid.bottom }} />}
                    </div>
                  )}
                </div>
              ) : (
                /* 테이블 (리스트 뷰) */
                <div ref={materialListRef} className="min-w-0" data-ails-workspace-list>
                  <table className="w-full table-fixed whitespace-nowrap border-collapse text-left text-xs"
                    style={{ display: listColumns.name > 0 ? undefined : "none" }}
                    aria-rowcount={sortedMaterials.length + 1}>
                    <colgroup>
                      <col style={{ width: listColumns.name }} />
                      {listColumns.kind !== null && <col style={{ width: listColumns.kind }} />}
                      {listColumns.modified !== null && <col style={{ width: listColumns.modified }} />}
                      {listColumns.actions !== null && <col style={{ width: listColumns.actions }} />}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-white/[0.05] dark:bg-white/[0.02] dark:text-white/40">
                        <th
                          data-workspace-column="name"
                          className="overflow-hidden px-3 py-2.5 cursor-pointer select-none hover:text-slate-800 dark:hover:text-white transition-colors"
                          onClick={() => handleSetSortOption(sortOption === "name_asc" ? "name_desc" : "name_asc")}
                        >
                          <div className="flex items-center gap-1">
                            <span>{t("이름")}</span>
                            {sortOption === "name_asc" && <ArrowUp size={12} className="text-blue-600 dark:text-blue-400" />}
                            {sortOption === "name_desc" && <ArrowDown size={12} className="text-blue-600 dark:text-blue-400" />}
                            {sortOption !== "name_asc" && sortOption !== "name_desc" && (
                              <span className="text-slate-300 dark:text-white/20">▲</span>
                            )}
                          </div>
                        </th>
                        {listColumns.kind !== null && <th
                          data-workspace-column="kind"
                          className="px-3 py-2.5 cursor-pointer select-none hover:text-slate-800 dark:hover:text-white transition-colors"
                          onClick={() => handleSetSortOption("kind_asc")}
                        >
                          <div className="flex items-center gap-1">
                            <span>{t("유형")}</span>
                            {sortOption === "kind_asc" && <ArrowUp size={12} className="text-blue-600 dark:text-blue-400" />}
                          </div>
                        </th>}
                        {listColumns.modified !== null && <th
                          data-workspace-column="modified"
                          className="whitespace-nowrap px-3 py-2.5 cursor-pointer select-none hover:text-slate-800 dark:hover:text-white transition-colors"
                          onClick={() => handleSetSortOption(sortOption === "updated_desc" ? "updated_asc" : "updated_desc")}
                        >
                          <div className="flex items-center gap-1">
                            <span>{t("수정일")}</span>
                            {sortOption === "updated_desc" && <ArrowDown size={12} className="text-blue-600 dark:text-blue-400" />}
                            {sortOption === "updated_asc" && <ArrowUp size={12} className="text-blue-600 dark:text-blue-400" />}
                          </div>
                        </th>}
                        {listColumns.actions !== null && <th data-workspace-column="actions" className="px-2 py-2.5 text-center">···</th>}
                      </tr>
                    </thead>
                    <tbody ref={materialBodyRef}>
                      {materialRows.start > 0 && <tr aria-hidden="true"><td colSpan={listColumns.count} style={{ height: materialRows.start * HOME_MATERIAL_ROW_HEIGHT, padding: 0, border: 0 }} /></tr>}
                      {sortedMaterials.length === 0 ? (
                        <tr>
                          <td className="overflow-hidden px-4 py-8 text-center text-slate-400 dark:text-white/40" colSpan={listColumns.count}>
                            {lectureMaterials == null ? t("자료 목록을 준비 중입니다.") : t("작업공간에 학습 자료가 없습니다.")}
                          </td>
                        </tr>
                      ) : (
                        sortedMaterials.slice(materialRows.start, materialRows.end).map((item, index) => {
                          const isSelected = workspaceSelection.selectedPaths.has(item.path)
                          const isFolder = item.kind === "folder"
                          return (
                            <tr
                              className={`group cursor-default select-none transition-colors ${workspaceClipboard.isCut(item.path) ? "opacity-50" : ""} ${isSelected ? "bg-blue-100 hover:bg-blue-200/70 dark:bg-blue-900/50 dark:hover:bg-blue-900/70" : "hover:bg-blue-50 dark:hover:bg-blue-500/10"}`}
                              key={item.id}
                              data-ails-workspace-item={item.path}
                              data-ails-workspace-cut={workspaceClipboard.isCut(item.path) || undefined}
                              data-ails-workspace-index={materialRows.start + index}
                              aria-selected={isSelected}
                              aria-rowindex={materialRows.start + index + 2}
                              style={{ height: HOME_MATERIAL_ROW_HEIGHT }}
                              tabIndex={0}
                              onClick={(event) => selectWorkspaceMaterial(item, event)}
                              onDoubleClick={(event) => openWorkspaceMaterial(event, item)}
                              onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return
                                if (event.key === "Enter") { event.preventDefault(); openMaterial(item) }
                                else if (event.key === " ") { event.preventDefault(); selectWorkspaceMaterial(item, event) }
                                else if (event.key === "Escape") clearWorkspaceSelection()
                              }}
                              onContextMenu={(e) => openWorkspaceMenu(e, item)}
                            >
                              <td data-workspace-column="name" className="overflow-hidden px-3 py-2.5 font-medium text-slate-800 dark:text-white/90">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {isFolder ? (
                                    <Folder className="shrink-0 text-blue-500 fill-blue-500/20" size={16} />
                                  ) : item.kind === "MP4" ? (
                                    <FileVideo className="shrink-0 text-indigo-500" size={16} />
                                  ) : item.kind === "IPYNB" ? (
                                    <Code2 className="shrink-0 text-amber-500" size={16} />
                                  ) : item.kind === "MD" ? (
                                    <Sparkles className="shrink-0 text-emerald-500" size={16} />
                                  ) : item.kind === "EPUB" ? (
                                    <BookOpen className="shrink-0 text-violet-500" size={16} />
                                  ) : (
                                    <FileText className="shrink-0 text-rose-500" size={16} />
                                  )}
                                  {inlineRenamePath === item.path && onRenameFile ? <WorkspaceInlineRename key={item.path} item={item} onRename={onRenameFile}
                                    onFinish={finishInlineRename} onError={setMaterialActionError} /> : <span data-ails-workspace-name className="min-w-0 flex-1 truncate" title={item.title}>{item.title}</span>}
                                  <MaterialProblemProgress solved={item.solvedProblemCount} total={item.problemCount} />
                                  {item.isPinned && <Pin size={12} className="shrink-0 text-[var(--brand)]" aria-label={t("상단 고정됨")} />}
                                </div>
                              </td>
                              {listColumns.kind !== null && <td data-workspace-column="kind" className="truncate px-3 py-2.5 text-slate-500 dark:text-white/50">
                                {isFolder ? t("폴더") : item.kind === "MD" ? t("정리본") : item.kind === "EPUB" ? "EPUB" : item.kind}
                              </td>}
                              {listColumns.modified !== null && <td data-workspace-column="modified" className="truncate px-3 py-2.5 font-mono text-slate-500 dark:text-white/50">
                                {item.date || "—"}
                              </td>}
                              {listColumns.actions !== null && <td data-workspace-column="actions" className="px-2 py-2.5 text-center text-slate-400 hover:text-slate-700 dark:hover:text-white" onClick={(e) => e.stopPropagation()}>
                                <button
                                  aria-label={t("더보기")}
                                  onClick={(e) => openWorkspaceMenu(e, item)}
                                  onContextMenu={(e) => openWorkspaceMenu(e, item)}
                                  title={t("더보기")}
                                  type="button"
                                >
                                  <MoreHorizontal size={14} />
                                </button>
                              </td>}
                            </tr>
                          )
                        })
                      )}
                      {materialRows.end < sortedMaterials.length && <tr aria-hidden="true"><td colSpan={listColumns.count} style={{ height: (sortedMaterials.length - materialRows.end) * HOME_MATERIAL_ROW_HEIGHT, padding: 0, border: 0 }} /></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              {marquee.rectangle && <div aria-hidden="true" data-ails-workspace-selection-rect
                className="pointer-events-none absolute z-30 border border-blue-500 bg-blue-500/15 dark:border-blue-400 dark:bg-blue-400/20"
                style={marquee.rectangle} />}
            </div>
          </section>
        </div>
        </WorkspaceBackgroundMenu>
        </div>
      </div>

      {!workspaceOnly && recentFilesOpen && <HomeRecentFilesDialog items={studyCards} onClose={() => setRecentFilesOpen(false)} onOpen={onOpenRecent} onSelect={selectMaterial} onMenu={openMaterialMenu} isOpening={isOpeningRecent} />}

      {/* ── 우측 상세 인스펙터 패널 ── */}
      {!workspaceOnly && (
        <div className="flex min-h-0 min-w-0 w-[18rem] max-w-[40%] shrink-0" data-ails-home-inspector-space="true">
          {inspectorOpen && selectedItem && (
            <FileInspectorPanel
              selectedItem={selectedItem}
              inspectorTab={inspectorTab}
              setInspectorTab={setInspectorTab}
              setInspectorOpen={setInspectorOpen}
              isFavorite={favoriteItems.has(selectedItem.id)}
              onToggleFavorite={toggleFavorite}
              isOpeningRecent={isOpeningRecent}
              onOpenRecent={onOpenRecent}
              onRefresh={onRefresh}
              onBackToAgent={onBackToAgent}
              onMoveToTrash={onMoveToTrash}
              documentTags={documentTags}
              practiceSet={selectedPracticeSet}
              onGeneratePractice={onGenerateFilePractice}
              onSolvePractice={onSolvePractice}
            />
          )}
        </div>
      )}

      {/* ── 공용 자료 더보기 메뉴 (3점 버튼 클릭 / 우클릭) ── */}
      {materialMenu && (
        <MaterialContextMenu
          materialMenu={materialMenu}
          setMaterialMenu={setMaterialMenu}
          favoriteItems={favoriteItems}
          pinnedPaths={pinnedPaths}
          ocrExcludedPaths={ocrExcludedPaths}
          isOpeningRecent={isOpeningRecent}
          onOpenFolderPath={navigateToFolder}
          onOpenRecent={onOpenRecent}
          onToggleFavorite={toggleFavorite}
          onTogglePin={togglePin}
          onToggleOcrExclusion={onToggleOcrExclusion}
          onSetOcrExclusions={onSetOcrExclusions}
          onRunOcr={quickActions.runOcr}
          onRenameItems={startInlineRename}
          canRename={Boolean(onRenameFile)}
          onMoveToTrash={(items) => {
            if (items.length === 1) onMoveToTrash(items[0].path)
            else if (onMoveSelectionToTrash) onMoveSelectionToTrash(contextDeleteTarget(items, lectureMaterials))
            else setMaterialActionError(t("여러 파일 삭제를 사용할 수 없습니다."))
          }}
          onHideFromRecent={hideFromRecent}
          onActionError={setMaterialActionError}
          onShowDetails={(items) => {
            setSelectedItemId(items[0].id)
            setDetails({ items, index: 0 })
          }}
        />
      )}

      {/* ── 심층 상세 정보 모달 (우측 패널보다 더 상세한 정보 제공) ── */}
      {detailedModalItem && (
        <DocumentDetailModal
          key={detailedModalItem.path}
          detailedModalItem={detailedModalItem}
          activeOcrJobs={activeOcrJobs}
          onGeneratePractice={onGenerateFilePractice}
          onSolvePractice={onSolvePractice}
          practiceSet={detailedModalItem.path === selectedItem?.path ? selectedPracticeSet : null}
          isFavorite={favoriteItems.has(detailedModalItem.id)}
          isPinned={pinnedPaths.some((path) => workspacePinKey(path) === workspacePinKey(detailedModalItem.path))}
          onClose={() => setDetails(null)}
          selectionNavigation={details && details.items.length > 1 ? { index: details.index, count: details.items.length,
            onSelect: (index) => setDetails(current => current ? { ...current, index } : null) } : undefined}
          onDocumentMetaChanged={onDocumentMetaChanged}
          onOpenAtPage={onOpenAtPage}
          onOpenRecent={(path) => detailedModalItem.kind === "folder" ? navigateToFolder(path) : onOpenRecent(path)}
          onToggleFavorite={toggleFavorite}
          onTogglePin={togglePin}
        />
      )}
    </section>
  )
}
