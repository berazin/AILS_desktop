import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Folder, LayoutGrid, List, RefreshCw, Search } from "lucide-react"
import { browseWorkspaceProjects, type WorkspaceProject } from "./api.ts"
import type { FolderWorkbench } from "./use-folder-workbench.ts"
import { useWorkspaceListColumns } from "../../../shared/hooks/use-workspace-list-columns.ts"

const normalizedPath = (path: string) => path.replace(/\\/g, "/").toLowerCase()
const isLinked = (project: WorkspaceProject, path: string) => project.pdfs.some((document) => normalizedPath(document.path) === normalizedPath(path))

export function CodeProjectBrowser({ workbench, documentPath, onBack }: {
  workbench: FolderWorkbench; documentPath: string; onBack: () => void
}) {
  const [listing, setListing] = useState<{ root: string; projects: WorkspaceProject[] } | null>(null)
  const [onlyLinked, setOnlyLinked] = useState(true)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<"list" | "grid">("list")
  const [sort, setSort] = useState<"modified" | "name">("modified")
  const [selectedPath, setSelectedPath] = useState("")
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const columns = useWorkspaceListColumns(listRef, view === "list", 0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    void browseWorkspaceProjects(controller.signal).then((result) => {
      if (!controller.signal.aborted) setListing(result)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision])

  const projects = useMemo(() => (listing?.projects ?? [])
    .filter((project) => (!onlyLinked || isLinked(project, documentPath)) && project.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => sort === "modified" ? right.modified - left.modified || left.name.localeCompare(right.name, "ko", { numeric: true })
      : left.name.localeCompare(right.name, "ko", { numeric: true })), [listing, onlyLinked, documentPath, query, sort])

  const openProject = (project: WorkspaceProject) => {
    if (project.available && !workbench.busy) void workbench.openFolder(false, project, { linkDocument: false })
  }
  const modifiedLabel = (project: WorkspaceProject) => new Date(project.modified * 1000).toLocaleString("ko-KR")

  return <section data-ails-code-project-browser className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--background)] text-[var(--foreground)]">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 text-sm">
      <button type="button" aria-label="코드 시작 화면으로 돌아가기" disabled={workbench.busy} onClick={onBack} className="rounded p-1 hover:bg-[var(--muted)] disabled:opacity-40"><ArrowLeft size={16} /></button>
      <span className="font-medium">프로젝트 열기</span>
    </header>
    <div className="shrink-0 space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-sm font-semibold">작업공간</h2>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyLinked} onChange={(event) => setOnlyLinked(event.target.checked)} />연결된 프로젝트만 보기</label>
        <button type="button" aria-label="그리드 보기" aria-pressed={view === "grid"} onClick={() => setView("grid")} className="rounded p-1.5 hover:bg-[var(--muted)]"><LayoutGrid size={16} /></button>
        <button type="button" aria-label="목록 보기" aria-pressed={view === "list"} onClick={() => setView("list")} className="rounded p-1.5 hover:bg-[var(--muted)]"><List size={16} /></button>
        <button type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)} className="flex items-center gap-1.5 rounded border border-[var(--border)] px-2.5 py-1.5 text-xs disabled:opacity-40"><RefreshCw size={13} className={loading ? "animate-spin" : ""} />목록 갱신</button>
      </div>
      <p className="truncate text-xs text-[var(--muted-foreground)]" title={listing?.root}>{listing?.root || "작업공간 목록을 불러오는 중…"}</p>
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2"><Search size={14} className="shrink-0 text-[var(--muted-foreground)]" /><input aria-label="프로젝트 검색" placeholder="프로젝트 검색" value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
        <select aria-label="프로젝트 정렬" value={sort} onChange={(event) => setSort(event.target.value as "modified" | "name")} className="rounded border border-[var(--border)] bg-[var(--panel)] p-2 text-xs"><option value="modified">최근 수정순</option><option value="name">이름순</option></select>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-auto px-5 pb-5" aria-busy={loading || workbench.busy}>
      {error && <p role="alert" className="mb-4 text-xs text-red-500">{error}</p>}
      {!loading && !error && projects.length === 0 && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">{query ? "검색 결과가 없습니다." : onlyLinked ? "이 문서에 연결된 프로젝트가 없습니다." : "작업공간에 프로젝트가 없습니다."}</p>}
      {view === "list" ? <div ref={listRef} data-code-project-list className="min-w-0"><table className="w-full table-fixed whitespace-nowrap text-left text-xs" style={{ display: columns.name > 0 ? undefined : "none" }}>
        <colgroup><col style={{ width: columns.name }} />{columns.kind !== null && <col style={{ width: columns.kind }} />}{columns.modified !== null && <col style={{ width: columns.modified }} />}</colgroup>
        <thead className="border-b border-[var(--border)] text-[var(--muted-foreground)]"><tr><th data-project-column="name" className="truncate px-3 py-3 font-normal">이름</th>{columns.kind !== null && <th data-project-column="linked" className="truncate px-3 py-3 font-normal">문서 연결</th>}{columns.modified !== null && <th data-project-column="modified" className="truncate px-3 py-3 font-normal">수정일</th>}</tr></thead>
        <tbody>{projects.map((project) => <tr key={project.path} data-code-project={project.path} tabIndex={project.available ? 0 : -1} aria-selected={selectedPath === project.path} aria-disabled={!project.available || workbench.busy}
          onClick={() => setSelectedPath(project.path)} onDoubleClick={() => openProject(project)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); openProject(project) } }}
          title={project.error || project.path} className={`border-b border-[var(--border)] outline-none hover:bg-[var(--interactive-hover)] focus-visible:bg-[var(--interactive-hover)] ${selectedPath === project.path ? "bg-[var(--brand-soft)]" : ""} ${!project.available ? "opacity-50" : ""}`}>
          <td data-project-column="name" className="overflow-hidden px-3 py-3"><span className="flex min-w-0 items-center gap-2"><Folder size={17} className="shrink-0 text-[var(--brand)]" /><span data-project-name title={project.name} className="min-w-0 truncate">{project.name}</span>{project.error && <span title={project.error} className="shrink-0 text-red-500">열기 불가</span>}</span></td>
          {columns.kind !== null && <td data-project-column="linked" className="truncate px-3 py-3 text-[var(--muted-foreground)]">{isLinked(project, documentPath) ? "연결됨" : "—"}</td>}{columns.modified !== null && <td data-project-column="modified" title={modifiedLabel(project)} className="truncate px-3 py-3 text-[var(--muted-foreground)]">{modifiedLabel(project)}</td>}
        </tr>)}</tbody>
      </table></div> : <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">{projects.map((project) => <button key={project.path} type="button" data-code-project={project.path} disabled={!project.available || workbench.busy}
        onClick={() => setSelectedPath(project.path)} onDoubleClick={() => openProject(project)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); openProject(project) } }}
        title={project.error || project.path} className={`rounded-xl border border-[var(--border)] p-5 text-left hover:bg-[var(--interactive-hover)] disabled:opacity-50 ${selectedPath === project.path ? "bg-[var(--brand-soft)]" : "bg-[var(--panel)]"}`}>
        <Folder size={32} className="mb-3 text-[var(--brand)]" /><span title={project.name} className="block truncate text-sm">{project.name}</span><span className="mt-2 block text-xs text-[var(--muted-foreground)]">{isLinked(project, documentPath) ? "연결됨" : "연결되지 않음"}</span>
      </button>)}</div>}
    </div>
  </section>
}
