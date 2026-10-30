import { useEffect, useState, type RefObject } from "react"
import { ChevronDown, ChevronRight, File, FilePlus2, FolderPlus, Pin, PinOff, RefreshCw, X } from "lucide-react"
import type { CodeWorkspace, WorkspaceEntry } from "./api.ts"
import type { useFolderEditor } from "./use-folder-editor.ts"

const button = "flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--muted)] disabled:opacity-40"
const dragType = "application/x-ails-workspace-entry"
export type FolderFileSidebarProps = {
  workspace: CodeWorkspace; state: ReturnType<typeof useFolderEditor>; onOpen: (path: string) => void
  onCreate: (directory: boolean, parent: string) => void; onRename: (path: string, directory: boolean) => void
  onOpenProject: () => void
  panelRef: RefObject<HTMLDivElement | null>; fontSize: number; pinned: boolean; onTogglePin: () => void
}
export function FolderFileSidebar({ workspace, state, onOpen, onCreate, onRename, onOpenProject, panelRef, fontSize, pinned, onTogglePin }: FolderFileSidebarProps) {
  const [selectedFolder, setSelectedFolder] = useState("")
  const [menu, setMenu] = useState<{ x: number; y: number; entry?: WorkspaceEntry } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close() }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", escape)
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape) }
  }, [menu])
  function drop(event: React.DragEvent, parent: string) {
    event.preventDefault(); event.stopPropagation()
    try {
      const entry = JSON.parse(event.dataTransfer.getData(dragType))
      if (entry.workspace !== workspace.id || typeof entry.path !== "string") return
      const destination = [parent, entry.path.split("/").at(-1)].filter(Boolean).join("/")
      if (entry.path === destination || parent.startsWith(`${entry.path}/`)) return
      void state.mutate("rename", entry.path, destination, entry.directory)
    } catch { /* Ignore unrelated browser drops. */ }
  }
  function entries(path = "", depth = 0): React.ReactNode {
    return state.tree[path]?.filter(item => item.directory || !/\.pdf$/i.test(item.name)).map((item) => <div key={item.path}>
      <div className={`group flex min-w-0 items-center ${state.active === item.path || selectedFolder === item.path ? "bg-[var(--brand-soft)]" : ""}`}
        draggable={!item.symlink && !state.busy} onDragStart={(event) => { event.dataTransfer.setData(dragType, JSON.stringify({ workspace: workspace.id, ...item })); event.dataTransfer.effectAllowed = "move" }}
        onDragOver={(event) => { if (!item.symlink && event.dataTransfer.types.includes(dragType)) { event.preventDefault(); event.stopPropagation() } }}
        onDrop={(event) => { if (!item.symlink) drop(event, item.directory ? item.path : path) }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 225), entry: item }) }}>
        <button className="flex min-w-0 flex-1 items-center gap-1 py-1.5 text-left hover:bg-[var(--muted)] disabled:opacity-40" style={{ paddingLeft: 8 + depth * 12 }} disabled={item.symlink} title={item.path}
          onKeyDown={(event) => {
            if (event.key === "Delete" && !state.busy) { event.preventDefault(); event.stopPropagation(); void state.mutate("delete", item.path, "", item.directory) }
          }}
          onClick={() => { if (item.directory) { setSelectedFolder(item.path); void state.toggleFolder(item.path) } else { setSelectedFolder(path); onOpen(item.path) } }}>
          {item.directory ? state.expanded.has(item.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <File size={12} />}<span className="truncate">{item.name}</span>
        </button>
        <button className="px-1 opacity-0 group-hover:opacity-100 focus:opacity-100" title="이름 변경" aria-label={`${item.name} 이름 변경`} disabled={state.busy || item.symlink} onClick={() => onRename(item.path, item.directory)}>···</button>
        <button className="px-1 opacity-0 group-hover:opacity-100 focus:opacity-100" title="삭제" aria-label={`${item.name} 삭제`} disabled={state.busy || item.symlink} onClick={() => void state.mutate("delete", item.path, "", item.directory)}><X size={11} /></button>
      </div>
      {item.directory && state.expanded.has(item.path) && entries(item.path, depth + 1)}
    </div>)
  }
  const parent = menu?.entry?.directory ? menu.entry.path : menu?.entry?.path.split("/").slice(0, -1).join("/") || ""
  return <div ref={panelRef} className="flex min-w-0 flex-1 flex-col overflow-hidden" style={{ fontSize }}>
    <div className="flex items-center gap-1 p-1">
      <button className={`${button} min-w-0 flex-1 truncate`} title={selectedFolder || workspace.path} onClick={() => setSelectedFolder("")}>파일</button>
      <button className={button} aria-label="새 파일" onClick={() => onCreate(false, selectedFolder)} disabled={state.busy}><FilePlus2 size={13} /></button>
      <button className={button} aria-label="새 폴더" onClick={() => onCreate(true, selectedFolder)} disabled={state.busy}><FolderPlus size={13} /></button>
      <button className={button} aria-label="파일 목록 새로고침" onClick={() => void state.refresh(selectedFolder)}><RefreshCw size={12} /></button>
      <button className={`${button} px-1 ${pinned ? "text-[var(--brand)]" : "text-[var(--muted-foreground)]"}`} aria-label="파일 탐색기 고정" aria-pressed={pinned}
        title={pinned ? "고정 해제하고 접기" : "파일 탐색기 고정하여 펼치기"} onClick={onTogglePin}>
        {pinned ? <Pin size={13} className="fill-current" /> : <PinOff size={13} />}
      </button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto" onContextMenu={(event) => { event.preventDefault(); setMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 225) }) }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(dragType)) event.preventDefault() }} onDrop={(event) => drop(event, "")}>{entries()}</div>
    <div data-ails-workspace-project-open className="shrink-0 border-t border-[var(--border)] p-2 text-xs">
      <div className="flex items-center justify-between gap-2"><span className="font-semibold">프로젝트</span>
        <button className={button} onClick={onOpenProject}>프로젝트 열기</button></div>
    </div>
    {menu && <div role="menu" aria-label="파일 메뉴" className="fixed z-[130] grid w-44 rounded border border-[var(--border)] bg-[var(--panel)] p-1 text-xs shadow-xl" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
      <button role="menuitem" className={button} disabled={state.busy || menu.entry?.symlink} onClick={() => { onCreate(false, parent); setMenu(null) }}>새 파일</button>
      <button role="menuitem" className={button} disabled={state.busy || menu.entry?.symlink} onClick={() => { onCreate(true, parent); setMenu(null) }}>새 폴더</button>
      {menu.entry && <>
        <button role="menuitem" className={button} disabled={state.busy || menu.entry.symlink} onClick={() => { onRename(menu.entry!.path, menu.entry!.directory); setMenu(null) }}>이름 변경 / 이동</button>
        <button role="menuitem" className={button} disabled={state.busy || menu.entry.symlink} onClick={() => { void state.mutate("delete", menu.entry!.path, "", menu.entry!.directory); setMenu(null) }}>삭제</button>
      </>}
      <button role="menuitem" className={button} onClick={() => { void state.refresh(parent); setMenu(null) }}>새로고침</button>
    </div>}
  </div>
}
