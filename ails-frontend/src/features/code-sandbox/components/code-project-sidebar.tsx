import { IDE_ENABLED } from "../../../edition.ts"
import { t } from "../../../lib/i18n.ts"
import React from "react"
import { Folder, FolderOpen, Plus } from "lucide-react"
import { type PdfProblem, type PdfProblemAnswerType, type PdfProblemAutoReviewStatus } from "../../../lib/api"
import { PracticeProblemNavigator } from "./practice-problem-navigator.tsx"
import { PracticeNavigationFoldButton, PracticeNavigationRail } from "./practice-navigation-fold.tsx"
import { normalizeProjectPath, parentProjectPath } from "../lib/code-project-browser.ts"
import { baseName, type SandboxFile } from "../lib/code-sandbox-support.ts"

interface CodeProjectSidebarProps {
  navigationFold: { collapsed: boolean; toggle: () => void }
  retryControls?: React.ReactNode
  sidebarPanelRef: React.RefObject<HTMLDivElement | null>
  handleSidebarWheel: (event: React.WheelEvent<HTMLDivElement>) => void
  sidebarWidth: number
  sidebarListFontSize: number
  practiceWindow: boolean
  sidebarMode: "problems" | "code"
  pdfPath: string
  isProblemActionPending: boolean
  problemActionLockRef: React.RefObject<{ kind: "timer" | "type" | "grade" | "review" | "edit"; scope: string; token: number; } | null>
  setSidebarMode: React.Dispatch<React.SetStateAction<"problems" | "code">>
  activeChapterProblems: PdfProblem[]
  activeProblem: PdfProblem | null
  batchDialogAnsweredCount: number
  batchDialogChangedCount: number
  batchDialogProblems: PdfProblem[]
  batchProblemHasAnswer: (problem: PdfProblem) => boolean
  expandedPracticeChapters: Set<string>
  isAnalyzingProblems: boolean
  isLoadingProblems?: boolean
  isPracticeSelectionMode: boolean
  navigatorChapters: import("../../../lib/problem-study.ts").PdfProblemNavigatorChapter[]
  onReviewAllProblems: (() => void | Promise<void>) | undefined
  onReviewAllProblemsLocal: (() => void | Promise<void>) | undefined
  openProblemBatchDialog: (problemIds: Iterable<string>) => void
  openProblemEditor: (problem: PdfProblem, options?: { source?: "user" | "ai"; proposal?: { problem_text: string; number: number; page: number; page_end: number; answer_type: PdfProblemAnswerType; choices: string[]; reason: string; changed: boolean; }; provider?: string; model?: string; }) => void
  practiceProblems: PdfProblem[]
  problemAnalysisError: string
  problemAutoReviewStatus: PdfProblemAutoReviewStatus | null
  problemBatchDialogIds: string[] | null
  selectPracticeProblem: (problem: PdfProblem) => void
  selectedPracticeProblemIds: Set<string>
  setExpandedPracticeChapters: React.Dispatch<React.SetStateAction<Set<string>>>
  setIsPracticeSelectionMode: React.Dispatch<React.SetStateAction<boolean>>
  setProblemBatchDialogIds: React.Dispatch<React.SetStateAction<string[] | null>>
  setSelectedPracticeProblemIds: React.Dispatch<React.SetStateAction<Set<string>>>
  startProblemBatchGrading: (mode: "changed" | "all") => Promise<void>
  togglePracticeProblemSelection: (problemIds: string[], selected?: boolean) => void
  projectName: string
  setIsAddingFile: React.Dispatch<React.SetStateAction<boolean>>
  isAddingFile: boolean
  addFile: (event?: React.FormEvent) => Promise<void>
  newFileName: string
  setNewFileName: React.Dispatch<React.SetStateAction<string>>
  folders: [string, SandboxFile[]][]
  renamingFileId: string
  commitRename: (fileId: string) => Promise<void>
  renameDraft: string
  setRenameDraft: React.Dispatch<React.SetStateAction<string>>
  setRenamingFileId: React.Dispatch<React.SetStateAction<string>>
  activeFileId: string
  setActiveFileId: React.Dispatch<React.SetStateAction<string>>
  deleteFile: (fileId: string) => Promise<void>
  position: { x: number; y: number; }
  setContextMenu: React.Dispatch<React.SetStateAction<{ visible: boolean; x: number; y: number; fileId: string; projectName: string; type: "file" | "project" | "project-space"; }>>
  normalizedProjectFolderPath: string
  setIsCreatingProject: React.Dispatch<React.SetStateAction<boolean>>
  setNewProjectName: React.Dispatch<React.SetStateAction<string>>
  draggingProjectPath: string
  handleMoveProject: (sourceProj: string, targetFolder: string) => Promise<void>
  handleSwitchProject: (targetProj: string, options?: { loadFiles?: boolean; flushDrafts?: boolean; }) => Promise<void>
  parentProjectFolderPath: string
  projectBrowserEntries: import("../lib/code-project-browser.ts").ProjectBrowserEntry[]
  selectedProjectPath: string
  isManagedProblemProjectPath: (path: string) => boolean
  setSelectedProjectPath: React.Dispatch<React.SetStateAction<string>>
  setDraggingProjectPath: React.Dispatch<React.SetStateAction<string>>
  handleSidebarResizeDown: (event: React.MouseEvent) => void
}

export function CodeProjectSidebar({
  navigationFold,
  retryControls,
  sidebarPanelRef,
  handleSidebarWheel,
  sidebarWidth,
  sidebarListFontSize,
  practiceWindow,
  sidebarMode,
  pdfPath,
  isProblemActionPending,
  problemActionLockRef,
  setSidebarMode,
  activeChapterProblems,
  activeProblem,
  batchDialogAnsweredCount,
  batchDialogChangedCount,
  batchDialogProblems,
  batchProblemHasAnswer,
  expandedPracticeChapters,
  isAnalyzingProblems,
  isLoadingProblems = false,
  isPracticeSelectionMode,
  navigatorChapters,
  onReviewAllProblems,
  onReviewAllProblemsLocal,
  openProblemBatchDialog,
  openProblemEditor,
  practiceProblems,
  problemAnalysisError,
  problemAutoReviewStatus,
  problemBatchDialogIds,
  selectPracticeProblem,
  selectedPracticeProblemIds,
  setExpandedPracticeChapters,
  setIsPracticeSelectionMode,
  setProblemBatchDialogIds,
  setSelectedPracticeProblemIds,
  startProblemBatchGrading,
  togglePracticeProblemSelection,
  projectName,
  setIsAddingFile,
  isAddingFile,
  addFile,
  newFileName,
  setNewFileName,
  folders,
  renamingFileId,
  commitRename,
  renameDraft,
  setRenameDraft,
  setRenamingFileId,
  activeFileId,
  setActiveFileId,
  deleteFile,
  position,
  setContextMenu,
  normalizedProjectFolderPath,
  setIsCreatingProject,
  setNewProjectName,
  draggingProjectPath,
  handleMoveProject,
  handleSwitchProject,
  parentProjectFolderPath,
  projectBrowserEntries,
  selectedProjectPath,
  isManagedProblemProjectPath,
  setSelectedProjectPath,
  setDraggingProjectPath,
  handleSidebarResizeDown,
}: CodeProjectSidebarProps) {
  const collapsed = practiceWindow && navigationFold.collapsed
  return (
    <div
      data-practice-navigation-panel
      data-practice-navigation-collapsed={collapsed ? "true" : undefined}
      className="ails-code-sidebar-panel ails-code-layout-border-subtle relative block shrink-0 border-r bg-[var(--practice-sidebar)] focus:outline-none"
      ref={sidebarPanelRef}
      onWheel={handleSidebarWheel}
      style={{
        width: collapsed ? 48 : sidebarWidth,
        "--ails-code-sidebar-list-font-size": `${sidebarListFontSize}px`,
      } as React.CSSProperties}
      tabIndex={0}
    >
      {collapsed && <PracticeNavigationRail number={activeProblem?.number} onToggle={navigationFold.toggle} />}
      <div className="flex h-full flex-col select-none">
        {IDE_ENABLED && practiceWindow && (
          <div className="ails-code-layout-border-subtle grid shrink-0 grid-cols-2 gap-1 border-b p-1.5">
            <button
              className={`rounded px-2 py-1.5 text-[10px] font-bold transition-colors ${
                sidebarMode === "problems"
                  ? "bg-[var(--muted)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
              disabled={!pdfPath || isProblemActionPending}
              onClick={() => {
                if (!problemActionLockRef.current) setSidebarMode("problems")
              }}
              type="button"
            >
              {t("문제")}</button>
            <button
              className={`rounded px-2 py-1.5 text-[10px] font-bold transition-colors ${
                sidebarMode === "code"
                  ? "bg-[var(--muted)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
              disabled={isProblemActionPending}
              onClick={() => {
                if (!problemActionLockRef.current) setSidebarMode("code")
              }}
              type="button"
            >
              {t("코드")}</button>
          </div>
        )}
        {practiceWindow && sidebarMode === "problems" ? (
          <PracticeProblemNavigator
            foldControl={<PracticeNavigationFoldButton collapsed={false} onToggle={navigationFold.toggle} />}
            retryControls={retryControls}
            activeChapterProblems={activeChapterProblems}
            activeProblem={activeProblem}
            batchDialogAnsweredCount={batchDialogAnsweredCount}
            batchDialogChangedCount={batchDialogChangedCount}
            batchDialogProblems={batchDialogProblems}
            batchProblemHasAnswer={batchProblemHasAnswer}
            expandedPracticeChapters={expandedPracticeChapters}
            isAnalyzingProblems={isAnalyzingProblems}
            isLoadingProblems={isLoadingProblems}
            isPracticeSelectionMode={isPracticeSelectionMode}
            isProblemActionPending={isProblemActionPending}
            navigatorChapters={navigatorChapters}
            onReviewAllProblems={onReviewAllProblems}
            onReviewAllProblemsLocal={onReviewAllProblemsLocal}
            openProblemBatchDialog={openProblemBatchDialog}
            openProblemEditor={openProblemEditor}
            practiceProblems={practiceProblems}
            problemAnalysisError={problemAnalysisError}
            problemAutoReviewStatus={problemAutoReviewStatus}
            problemBatchDialogIds={problemBatchDialogIds}
            selectPracticeProblem={selectPracticeProblem}
            selectedPracticeProblemIds={selectedPracticeProblemIds}
            setExpandedPracticeChapters={setExpandedPracticeChapters}
            setIsPracticeSelectionMode={setIsPracticeSelectionMode}
            setProblemBatchDialogIds={setProblemBatchDialogIds}
            setSelectedPracticeProblemIds={setSelectedPracticeProblemIds}
            startProblemBatchGrading={startProblemBatchGrading}
            togglePracticeProblemSelection={togglePracticeProblemSelection}
          />
        ) : (
          <>
        {/* 위쪽: 파일 트리 */}
        <div className="ails-code-sidebar-section ails-code-layout-border-subtle flex-1 min-h-0 overflow-auto p-2 text-[var(--foreground)] border-b">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Files</span>
            <button
              className="rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)] transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              onClick={() => {
                if (projectName) setIsAddingFile(true)
              }}
              disabled={!projectName}
              title={projectName ? "Add file" : "Open a project folder first"}
              type="button"
            >
              <Plus size={12} />
            </button>
          </div>
          {isAddingFile && (
            <form className="mb-2 flex items-center gap-1 rounded-md border border-[var(--border)] bg-white dark:bg-zinc-900 px-1.5 py-0.5" onSubmit={addFile}>
              <input
                autoFocus
                className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[10px] font-medium text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none"
                placeholder="main.py"
                value={newFileName}
                onBlur={() => {
                  if (!newFileName.trim()) setIsAddingFile(false)
                }}
                onChange={(event) => setNewFileName(event.target.value)}
                spellCheck={false}
              />
              <button className="rounded bg-[var(--brand)] p-0.5 text-white" type="submit">
                <Plus size={10} />
              </button>
            </form>
          )}
          {folders.map(([folder, folderFiles]) => (
            <div key={folder} className="mb-2">
              {folder !== "." && (
                <div className="ails-code-sidebar-list-text mb-1 truncate font-bold text-[var(--muted-foreground)]">{folder}</div>
              )}
              {folderFiles.map((file) => (
                renamingFileId === file.id ? (
                  <form
                    key={file.id}
                    onSubmit={(event) => {
                      event.preventDefault()
                      commitRename(file.id)
                    }}
                  >
                    <input
                      autoFocus
                      className="ails-code-sidebar-list-text mb-0.5 w-full rounded border border-[var(--border)] bg-white dark:bg-zinc-900 px-1 py-0.5 text-[var(--foreground)] outline-none ring-1 ring-[var(--brand)]"
                      value={renameDraft}
                      onBlur={() => commitRename(file.id)}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setRenamingFileId("")
                          setRenameDraft("")
                        }
                      }}
                    />
                  </form>
                ) : (
                  <button
                    key={file.id}
                    className={`ails-code-sidebar-list-text block w-full truncate rounded px-1.5 py-1 text-left transition-colors ${file.id === activeFileId ? "bg-[var(--muted)] text-[var(--foreground)] font-bold ring-1 ring-inset ring-[var(--border)]" : "text-[var(--foreground)]/80 hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]"}`}
                    onClick={() => setActiveFileId(file.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Delete") {
                        event.preventDefault()
                        void deleteFile(file.id)
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setActiveFileId(file.id)
                      const rect = event.currentTarget.closest('[data-ails-code-sandbox="true"]')?.getBoundingClientRect()
                      const x = rect ? event.clientX - rect.left : event.clientX - position.x
                      const y = rect ? event.clientY - rect.top : event.clientY - position.y
                      setContextMenu({
                        visible: true,
                        x,
                        y,
                        fileId: file.id,
                        projectName: "",
                        type: "file",
                      })
                    }}
                    title="Right-click for options"
                    type="button"
                  >
                    {file.code !== file.savedCode ? "* " : ""}
                    {baseName(file.name)}
                  </button>
                )
              ))}
            </div>
          ))}
        </div>

        {/* 아래쪽: 프로젝트 폴더 리스트 */}
        <div className="ails-code-sidebar-section ails-code-layout-border-subtle h-[40%] min-h-0 overflow-auto p-2 text-[var(--foreground)] flex flex-col border-t">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block truncate font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Projects</span>
              {normalizedProjectFolderPath && (
                <span className="ails-code-sidebar-meta block truncate font-mono text-[var(--muted-foreground)] font-medium" title={normalizedProjectFolderPath}>
                  /{normalizedProjectFolderPath}
                </span>
              )}
            </div>
            <button
              className="rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)] transition-colors"
              onClick={() => {
                setIsCreatingProject(true)
                setNewProjectName("")
              }}
              title="New project folder (Ctrl+Shift+P)"
              type="button"
            >
              <Plus size={12} />
            </button>
          </div>
          <div
            className={`ails-code-project-list flex-1 overflow-auto space-y-1 pr-1 ${
              Boolean(draggingProjectPath) &&
              normalizeProjectPath(draggingProjectPath) !== normalizedProjectFolderPath &&
              !normalizedProjectFolderPath.startsWith(`${normalizeProjectPath(draggingProjectPath)}/`) &&
              parentProjectPath(normalizeProjectPath(draggingProjectPath)) !== normalizedProjectFolderPath
                ? "ring-2 ring-[var(--brand)]/20 bg-[var(--brand-soft)]/20 rounded-lg"
                : ""
            }`}
            onContextMenu={(event) => {
              const target = event.target as HTMLElement
              if (target.closest(".ails-code-project-entry")) return
              event.preventDefault()
              event.stopPropagation()
              const rect = event.currentTarget.closest('[data-ails-code-sandbox="true"]')?.getBoundingClientRect()
              const x = rect ? event.clientX - rect.left : event.clientX - position.x
              const y = rect ? event.clientY - rect.top : event.clientY - position.y
              setContextMenu({
                visible: true,
                x,
                y,
                fileId: "",
                projectName: normalizedProjectFolderPath,
                type: "project-space",
              })
            }}
            onDragOver={(event) => {
              if (!draggingProjectPath) return
              const sourcePath = normalizeProjectPath(draggingProjectPath)
              const canDropContainer =
                Boolean(sourcePath) &&
                sourcePath !== normalizedProjectFolderPath &&
                !normalizedProjectFolderPath.startsWith(`${sourcePath}/`) &&
                parentProjectPath(sourcePath) !== normalizedProjectFolderPath
              if (canDropContainer) {
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
              }
            }}
            onDrop={(event) => {
              if (!draggingProjectPath) return
              event.preventDefault()
              const sourcePath = normalizeProjectPath(draggingProjectPath)
              const canDropContainer =
                Boolean(sourcePath) &&
                sourcePath !== normalizedProjectFolderPath &&
                !normalizedProjectFolderPath.startsWith(`${sourcePath}/`) &&
                parentProjectPath(sourcePath) !== normalizedProjectFolderPath
              if (canDropContainer) {
                void handleMoveProject(sourcePath, normalizedProjectFolderPath)
              }
            }}
          >
            {normalizedProjectFolderPath && (
              <button
                className="ails-code-project-entry ails-code-sidebar-list-text flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left font-mono text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                onClick={() => void handleSwitchProject(parentProjectFolderPath, { loadFiles: true })}
                onDragOver={(event) => {
                  if (!draggingProjectPath) return
                  event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (draggingProjectPath) void handleMoveProject(draggingProjectPath, parentProjectFolderPath)
                }}
                title="Parent folder"
                type="button"
              >
                <FolderOpen size={11} className="shrink-0 text-[var(--muted-foreground)]" />
                <span className="truncate font-bold">...</span>
              </button>
            )}
            {projectBrowserEntries.map((entry) => {
              const sourcePath = normalizeProjectPath(draggingProjectPath)
              const canDrop =
                Boolean(sourcePath) &&
                sourcePath !== entry.path &&
                !entry.path.startsWith(`${sourcePath}/`)
              const isSelected = selectedProjectPath === entry.path
              const isManagedPath = isManagedProblemProjectPath(entry.path)
              return (
              <button
                key={entry.path}
                draggable={!isManagedPath}
                className={`ails-code-project-entry ails-code-sidebar-list-text flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left font-mono transition-colors ${isSelected ? "bg-[var(--brand-soft)] text-[var(--brand)] font-bold ring-1 ring-inset ring-[var(--brand)]/20" : "text-[var(--foreground)]/80 hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]"} ${canDrop ? "ring-1 ring-inset ring-[var(--brand)]/40" : ""} ${isManagedPath ? "cursor-default" : ""}`}
                onClick={() => setSelectedProjectPath(entry.path)}
                onDoubleClick={() => void handleSwitchProject(entry.path, { loadFiles: true })}
                onDragStart={(event) => {
                  if (isManagedPath) {
                    event.preventDefault()
                    return
                  }
                  setDraggingProjectPath(entry.path)
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData("text/plain", entry.path)
                }}
                onDragEnd={() => setDraggingProjectPath("")}
                onDragOver={(event) => {
                  if (!canDrop) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "move"
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (canDrop) void handleMoveProject(sourcePath, entry.path)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setSelectedProjectPath(entry.path)
                  setContextMenu({
                    visible: true,
                    x: event.clientX,
                    y: event.clientY,
                    fileId: "",
                    projectName: entry.path,
                    type: "project"
                  })
                }}
                title={isManagedPath ? t("PDF 문제 상태와 연결된 보호 폴더") : "Double-click to open; drag another folder here to move it inside."}
                type="button"
              >
                {isSelected ? <FolderOpen size={11} className="shrink-0 text-[var(--brand)]" /> : <Folder size={11} className="shrink-0 text-[var(--muted-foreground)]" />}
                <span className="truncate font-medium">{entry.name}</span>
              </button>
              )
            })}
            {projectBrowserEntries.length === 0 && (
              <div className="ails-code-sidebar-list-text text-[var(--muted-foreground)] text-center py-4 font-medium">
                {normalizedProjectFolderPath ? "No projects in this folder." : "No projects found."}
              </div>
            )}
          </div>
        </div>
          </>
        )}
      </div>
      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent"
        onMouseDown={handleSidebarResizeDown}
        title="Resize file panel"
      />
    </div>
  )
}
