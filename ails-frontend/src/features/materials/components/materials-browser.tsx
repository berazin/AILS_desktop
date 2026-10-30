import type { DragEvent as ReactDragEvent, ReactNode } from "react"
import { useMemo } from "react"
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileAudio2,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Presentation,
} from "lucide-react"

import { MATERIAL_DRAG_MIME, MATERIAL_FOLDER_DRAG_MIME, isPathOcrExcluded, materialFileSelectionKey, materialFolderSelectionKey, materialWeekSelectionKey, type MaterialsController } from "../hooks/use-materials-controller.ts"
import type { LectureMaterialFolder } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { Input } from "../../../shared/ui/input.tsx"
import { MaterialTree } from "./material-tree.tsx"
import { type MaterialContextTarget } from "../../../lib/material-navigation.ts"

type MaterialsBrowserProps = {
  busyActions: Record<string, string>
  controller: MaterialsController
  folders: LectureMaterialFolder[]
  favoriteFilesClassName?: string
  includeFavoriteFiles?: boolean
  isBusy: (key: string) => boolean
  ocrExcludedPaths?: readonly string[] | null
  onAutoScrollDuringDrag: (event: ReactDragEvent<HTMLElement>) => void
  onCommitFolderRename: (path: string) => void
  onDropOnFolder: (event: ReactDragEvent<HTMLElement>, folder: LectureMaterialFolder) => void
  onNotice: (message: string) => void
  onOpenFile: (path: string) => void
  onGenerateFilePractice?: (target: MaterialContextTarget) => void
  onSolvePractice?: (path: string) => void
  renderKeySuffix: string
  searchText: string
}

function isTextbookFolderName(name: string) {
  const trimmed = name.trim()
  return trimmed === "교재" || trimmed === "援먯옱"
}

export function MaterialFileKindIcon({ kind, path, size = 13 }: { kind?: string; path?: string; size?: number }) {
  const ext = (path ? path.split(".").pop()?.toLowerCase() : "") || (kind || "").toLowerCase()
  if (ext === "pdf") return <FileText className="shrink-0 text-red-500" size={size} />
  if (ext === "ppt" || ext === "pptx") return <Presentation className="shrink-0 text-orange-500" size={size} />
  if (ext === "ipynb" || ext === "py") return <FileCode className="shrink-0 text-amber-500" size={size} />
  if (ext === "md" || ext === "markdown") return <FileText className="shrink-0 text-sky-500" size={size} />
  if (ext === "epub") return <BookOpen className="shrink-0 text-violet-500" size={size} />
  if (["mp4", "mkv", "avi", "mov", "webm"].includes(ext)) return <FileVideo2 className="shrink-0 text-purple-500" size={size} />
  if (["mp3", "wav", "m4a", "flac", "aac", "ogg"].includes(ext)) return <FileAudio2 className="shrink-0 text-emerald-500" size={size} />
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) return <ImageIcon className="shrink-0 text-pink-500" size={size} />
  if (["xlsx", "xls", "csv"].includes(ext)) return <FileSpreadsheet className="shrink-0 text-green-600" size={size} />
  return <FileText className="shrink-0 text-[var(--muted-foreground)]" size={size} />
}

// 선택된 파일 행의 왼쪽에 체크 표시를 렌더링한다 (일반 클릭=단일, Ctrl=토글, Shift=범위).
function MaterialSelectionCheck({ selected }: { selected: boolean }) {
  if (!selected) return null
  return <Check className="shrink-0 text-[var(--brand)]" size={12} />
}

export function MaterialsBrowser({
  busyActions,
  controller,
  favoriteFilesClassName,
  folders,
  includeFavoriteFiles = false,
  isBusy,
  ocrExcludedPaths,
  onAutoScrollDuringDrag,
  onCommitFolderRename,
  onDropOnFolder,
  onNotice,
  onOpenFile,
  renderKeySuffix,
  searchText,
}: MaterialsBrowserProps) {
  const { favoriteMaterialItems, lectureMaterials } = controller.data
  const {
    editingFolderName,
    editingFolderPath,
    setEditingFolderName,
    setEditingFolderPath,
  } = controller.editing
  const {
    openMaterialContextMenu,
    openMaterialFolderContextMenu,
  } = controller.menus
  const {
    handleMaterialSelectionClick,
    materialSelectionAnchor,
    materialSelectionClass,
    openSelectedMaterialContextMenu,
    selectedMaterialKeys,
  } = controller.selection
  const {
    expandedFiles,
    expandedFolders,
    expandedWeeks,
    handleMaterialDragStart,
    handleMaterialFolderDragStart,
    materialDropTargetPath,
    setMaterialDropTargetPath,
    toggleFolder,
    toggleWeek,
  } = controller.tree
  const setNotice = onNotice
  const handleOpenMaterialFile = onOpenFile
  const commitFolderRename = onCommitFolderRename
  const cancelFolderRename = () => {
    setEditingFolderPath("")
    setEditingFolderName("")
  }
  const autoScrollLectureMaterialsDuringDrag = onAutoScrollDuringDrag
  const handleMaterialDropOnFolder = onDropOnFolder
  function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function formatFileTitle(title: string, subjectName?: string): string {
    if (!subjectName) return title
    const escapedSubject = escapeRegExp(subjectName)
    const regex = new RegExp(escapedSubject + t("[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]*"), "i")
    const formatted = title.replace(regex, "").trim()
    return formatted || title
  }

  function renderMaterialFolder(folder: LectureMaterialFolder, depth = 0, subjectName?: string): ReactNode {
    const isVirtual = folder.is_virtual === true
    const folderOpen = expandedFolders.has(folder.path) || searchText.length > 0
    const hasDirectItems = folder.weeks.length > 0 || folder.files.length > 0
    const hasChildren = (folder.children?.length ?? 0) > 0
    const childItemCount = (folder.children?.length ?? 0) + folder.weeks.length + folder.files.length
    const currentSubjectName = depth === 0 ? folder.name : subjectName
    const isTextbookFolder = isTextbookFolderName(folder.name)
    const folderSelectionKey = materialFolderSelectionKey(folder.path)
    return (
      <div key={folder.path}>
        {editingFolderPath === folder.path ? (
          <div className="flex w-full items-center gap-2 rounded-lg bg-[var(--muted)] px-3 py-2 text-left text-sm ring-2 ring-[var(--brand)]">
            {folderOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {folderOpen ? (
              <FolderOpen className="shrink-0 text-amber-500 fill-amber-500/20" size={15} />
            ) : (
              <Folder className="shrink-0 text-amber-500 fill-amber-500/20" size={15} />
            )}
            <Input
              autoFocus
              className="h-7 min-w-0 flex-1 px-2 py-1 text-sm"
              value={editingFolderName}
              onBlur={() => void commitFolderRename(folder.path)}
              onChange={(event) => setEditingFolderName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  event.currentTarget.blur()
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  cancelFolderRename()
                }
              }}
            />
          </div>
        ) : (
          <button
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-all hover:bg-[var(--muted)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
              materialDropTargetPath === folder.path && "bg-[var(--brand-soft)] text-[var(--brand)]",
              materialSelectionClass(folderSelectionKey),
            )}
            onClick={(event) => {
              if (handleMaterialSelectionClick(event, folderSelectionKey)) return
              toggleFolder(folder.path)
              setNotice(`Folder ${folderOpen ? "collapsed" : "expanded"}: ${folder.name}`)
            }}
            onContextMenu={(event) => {
              if (isVirtual) return
              openMaterialFolderContextMenu(event, folder, folderSelectionKey)
            }}
            draggable={!isVirtual}
            onDragEnter={(event) => {
              if (isVirtual) return
              if (event.dataTransfer.types.includes(MATERIAL_DRAG_MIME) || event.dataTransfer.types.includes(MATERIAL_FOLDER_DRAG_MIME)) {
                setMaterialDropTargetPath(folder.path)
              }
            }}
            onDragLeave={() => {
              if (isVirtual) return
              setMaterialDropTargetPath((current) => (current === folder.path ? "" : current))
            }}
            onDragEnd={() => {
              if (isVirtual) return
              setMaterialDropTargetPath("")
            }}
            onDragOver={(event) => {
              if (isVirtual) return
              if (!event.dataTransfer.types.includes(MATERIAL_DRAG_MIME) && !event.dataTransfer.types.includes(MATERIAL_FOLDER_DRAG_MIME)) return
              event.preventDefault()
              autoScrollLectureMaterialsDuringDrag(event)
              event.dataTransfer.dropEffect = "move"
              setMaterialDropTargetPath(folder.path)
            }}
            onDragStart={(event) => {
              if (isVirtual) return
              handleMaterialFolderDragStart(event, folder)
            }}
            onDrop={(event) => {
              if (isVirtual) return
              void handleMaterialDropOnFolder(event, folder)
            }}
            type="button"
          >
            {folderOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {folderOpen ? (
              <FolderOpen className="shrink-0 text-amber-500 fill-amber-500/20" size={15} />
            ) : (
              <Folder className="shrink-0 text-amber-500 fill-amber-500/20" size={15} />
            )}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            {isPathOcrExcluded(folder.path, ocrExcludedPaths).excluded && (
              <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                {t("OCR 제외")}
              </span>
            )}
            <span className="text-xs text-[var(--muted-foreground)]">{childItemCount}</span>
          </button>
        )}
        {folderOpen && (
          <div className={cn("ails-collapsible-panel mt-1 space-y-1 border-l border-[var(--border)] pl-1", depth === 0 ? "ml-2" : "ml-1")}>
            {hasChildren && folder.children?.map((child) => renderMaterialFolder(child, depth + 1, currentSubjectName))}
            {!hasDirectItems && !hasChildren && (
              <div className="px-2 py-1 text-xs text-[var(--muted-foreground)]">{t("정리본이 없습니다.")}</div>
            )}
            {folder.files.length > 0 && (
              <div className={cn("ails-collapsible-panel space-y-1 py-1", isTextbookFolder ? "ml-1" : "ml-3")}>
                {folder.files.map((file) => {
                  const fileSelectionKey = materialFileSelectionKey(file.file_path)
                  return (
                    <div className="relative" key={file.file_path}>
                    <button
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--muted-foreground)] transition-all hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                        materialSelectionClass(fileSelectionKey),
                      )}
                      disabled={isBusy(`material-file-${file.file_path}`)}
                      draggable
                      onClick={(event) => {
                          if (handleMaterialSelectionClick(event, fileSelectionKey)) return
                          void handleOpenMaterialFile(file.file_path)
                      }}
                      onContextMenu={(event) =>
                        openMaterialContextMenu(event, {
                          path: file.file_path,
                          fileName: file.file_name,
                          title: file.title,
                          kind: file.kind,
                        }, fileSelectionKey)
                      }
                      onDragStart={(event) => handleMaterialDragStart(event, file.file_path, file.title)}
                      onDragEnd={() => setMaterialDropTargetPath("")}
                      type="button"
                    >
                      <MaterialSelectionCheck selected={selectedMaterialKeys.has(fileSelectionKey)} />
                      {isBusy(`material-file-${file.file_path}`) ? (
                        <Loader2 className="shrink-0 animate-spin" size={13} />
                      ) : (
                        <MaterialFileKindIcon kind={file.kind} path={file.file_path} size={13} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{formatFileTitle(file.title, currentSubjectName)}</span>
                      {isPathOcrExcluded(file.file_path, ocrExcludedPaths).excluded && (
                        <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-400">
                          {t("OCR 제외")}
                        </span>
                      )}
                      <span className="rounded bg-[var(--muted)] px-1 uppercase">{file.kind}</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            {folder.weeks.map((week) => {
              const weekKey = `${folder.path}:${week.week}`
              const weekSelectionKey = materialWeekSelectionKey(folder.path, week.week)
              const weekOpen = expandedWeeks.has(weekKey) || searchText.length > 0

              return (
                <div key={weekKey}>
                  <button
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-all hover:bg-[var(--muted)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                      materialSelectionClass(weekSelectionKey),
                    )}
                    onClick={(event) => {
                      if (handleMaterialSelectionClick(event, weekSelectionKey)) return
                      toggleWeek(folder.path, week.week)
                      setNotice(`${folder.name} week ${week.week} ${weekOpen ? "collapsed" : "expanded"}.`)
                    }}
                    onContextMenu={(event) => {
                      if (openSelectedMaterialContextMenu(event, weekSelectionKey)) return
                    }}
                    type="button"
                  >
                    {weekOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="min-w-0 flex-1 truncate">{week.week}{t("주차")}</span>
                    <span className="text-[var(--muted-foreground)]">{week.reports.length}</span>
                  </button>
                  {weekOpen && (
                    <div className="ails-collapsible-panel ml-3 space-y-1 py-1">
                      {week.reports.map((report) => {
                        const reportSelectionKey = materialFileSelectionKey(report.file_path)
                        return (
                          <div className="relative" key={report.file_path}>
                          <button
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--muted-foreground)] transition-all hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                              materialSelectionClass(reportSelectionKey),
                            )}
                            disabled={isBusy(`material-file-${report.file_path}`)}
                            draggable
                            onClick={(event) => {
                              if (handleMaterialSelectionClick(event, reportSelectionKey)) return
                              void handleOpenMaterialFile(report.file_path)
                            }}
                            onContextMenu={(event) =>
                              openMaterialContextMenu(event, {
                                path: report.file_path,
                                fileName: report.file_name,
                                title: report.title,
                                kind: "md",
                              }, reportSelectionKey)
                            }
                            onDragStart={(event) => handleMaterialDragStart(event, report.file_path, report.title)}
                            onDragEnd={() => setMaterialDropTargetPath("")}
                            type="button"
                          >
                            <MaterialSelectionCheck selected={selectedMaterialKeys.has(reportSelectionKey)} />
                            {isBusy(`material-file-${report.file_path}`) ? (
                              <Loader2 className="shrink-0 animate-spin" size={13} />
                            ) : (
                              <MaterialFileKindIcon kind="md" path={report.file_path} size={13} />
                            )}
                            <span className="min-w-0 flex-1 truncate">{report.sequence}{t("번 정리본")}</span>
                            <ExternalLink className="shrink-0" size={12} />
                          </button>
                        </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}

          </div>
        )}
      </div>
    )
  }

  // Tree rows must read the state from this render. A layout-effect callback ref
  // updates only after MaterialTree has already rendered, leaving clicks one step behind.
  const renderMaterialFolderForTree = (folder: LectureMaterialFolder) => renderMaterialFolder(folder)

  function renderFavoriteFile(item: { target: MaterialContextTarget; folderName: string }): ReactNode {
    const fileSelectionKey = materialFileSelectionKey(item.target.path)
    return (
      <button
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--muted-foreground)] transition-all hover:bg-[var(--muted)] hover:text-[var(--foreground)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
          materialSelectionClass(fileSelectionKey),
        )}
        disabled={isBusy(`material-file-${item.target.path}`)}
        draggable
        key={item.target.path}
        onClick={(event) => {
          if (handleMaterialSelectionClick(event, fileSelectionKey)) return
          void handleOpenMaterialFile(item.target.path)
        }}
        onContextMenu={(event) => openMaterialContextMenu(event, item.target, fileSelectionKey)}
        onDragStart={(event) => handleMaterialDragStart(event, item.target.path, item.target.title)}
        onDragEnd={() => setMaterialDropTargetPath("")}
        title={`${item.folderName} / ${item.target.title}`}
        type="button"
      >
        <MaterialSelectionCheck selected={selectedMaterialKeys.has(fileSelectionKey)} />
        {isBusy(`material-file-${item.target.path}`) ? (
          <Loader2 className="shrink-0 animate-spin" size={13} />
        ) : (
          <MaterialFileKindIcon kind={item.target.kind} path={item.target.path} size={13} />
        )}
        <span className="min-w-0 flex-1 truncate">{formatFileTitle(item.target.title, item.folderName)}</span>
        {isPathOcrExcluded(item.target.path, ocrExcludedPaths).excluded && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-400">
            {t("OCR 제외")}
          </span>
        )}
        <span className="shrink-0 rounded bg-[var(--muted)] px-1 uppercase">{item.target.kind}</span>
      </button>
    )
  }

  const materialTreeRenderKey = useMemo(() => {
    const keyFromSet = (values: Set<string>) => Array.from(values).sort().join("\u001f")
    const materialBusyKey = Object.keys(busyActions)
      .filter((key) => key.startsWith("material-file-"))
      .sort()
      .join("\u001f")
    return [
      lectureMaterials?.base_path ?? "",
      searchText,
      keyFromSet(expandedFolders),
      keyFromSet(expandedFiles),
      keyFromSet(expandedWeeks),
      keyFromSet(selectedMaterialKeys),
      materialSelectionAnchor ?? "",
      editingFolderPath,
      editingFolderName,
      materialDropTargetPath,
      materialBusyKey,
      (ocrExcludedPaths ?? []).join("\u001f"),
    ].join("\u001e")
  }, [
    busyActions,
    ocrExcludedPaths,
    editingFolderName,
    editingFolderPath,
    expandedFiles,
    expandedFolders,
    expandedWeeks,
    lectureMaterials?.base_path,
    materialDropTargetPath,
    materialSelectionAnchor,
    searchText,
    selectedMaterialKeys,
  ])

  return (
    <>
      <MaterialTree
        folders={folders}
        renderFolder={renderMaterialFolderForTree}
        renderKey={`${materialTreeRenderKey}:${renderKeySuffix}`}
      />
      {includeFavoriteFiles && favoriteMaterialItems.favoriteFiles.length > 0 && (
        favoriteFilesClassName ? (
          <div className={favoriteFilesClassName}>{favoriteMaterialItems.favoriteFiles.map(renderFavoriteFile)}</div>
        ) : (
          favoriteMaterialItems.favoriteFiles.map(renderFavoriteFile)
        )
      )}
    </>
  )
}
