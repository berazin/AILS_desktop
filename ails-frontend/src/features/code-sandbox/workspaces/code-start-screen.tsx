import { Code2, FileText, FolderOpen, FolderPlus, Link2, MoreHorizontal } from "lucide-react"
import type { FolderWorkbench } from "./use-folder-workbench.ts"
import { useState } from "react"
import { CodeProjectBrowser } from "./code-project-browser.tsx"

export function CodeStartScreen({ workbench, documentSelected = false }: { workbench: FolderWorkbench; documentSelected?: boolean }) {
  const [projectBrowserFor, setProjectBrowserFor] = useState("")
  if (workbench.linkSource && projectBrowserFor === workbench.linkSource) return <CodeProjectBrowser key={workbench.linkSource} workbench={workbench} documentPath={workbench.linkSource} onBack={() => setProjectBrowserFor("")} />
  return <div className="h-full overflow-auto px-8 py-12" data-ails-code-start="true">
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 inline-flex rounded-2xl bg-[var(--brand-soft)] p-4 text-[var(--brand)]"><Code2 size={30} /></div>
      <h1 className="text-2xl font-semibold">직접 실행하며 배우는 코드</h1>
      <p className="mt-3 text-sm text-[var(--muted-foreground)]">{documentSelected ? "옆의 문서를 보며 실습할 프로젝트를 시작하세요." : "프로젝트를 열고 코드를 작성하세요. 문서를 나란히 펼쳐 보며 실습할 수 있습니다."}</p>
      {workbench.linkSource && <label className="mt-5 flex items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-sm">
        <input type="checkbox" checked={workbench.linkNewWorkspace} onChange={(event) => workbench.setLinkNewWorkspace(event.target.checked)} /><Link2 size={14} />
        이 문서와 새 작업 연결: <span className="truncate" title={workbench.linkSource}>{workbench.linkSource.split(/[\\/]/).at(-1)}</span>
      </label>}
      <div className={`mt-8 grid gap-3 ${documentSelected ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        {[
          { title: "새 작업", description: null, icon: FolderPlus, action: () => void workbench.openFolder(true) },
          { title: "프로젝트 열기", description: null, icon: FolderOpen, action: () => documentSelected && workbench.linkSource ? setProjectBrowserFor(workbench.linkSource) : void workbench.openFolder(false) },
          ...(!documentSelected ? [{ title: "문서 열기", description: "읽으며 실습할 문서 열기", icon: FileText, action: () => void workbench.pickPdf() }] : []),
        ].map(({ title, description, icon: Icon, action }) => <button key={title} disabled={workbench.busy || !workbench.ready} onClick={action}
          className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] disabled:opacity-40">
          <Icon size={22} className="mb-4 text-[var(--brand)]" /><strong className="block text-sm">{title}</strong>{description && <span className="mt-1 block text-xs text-[var(--muted-foreground)]">{description}</span>}
        </button>)}
      </div>
      <div className="mb-3 mt-10 flex items-center justify-between"><h2 className="text-sm font-semibold">최근 작업</h2>
        <button className="text-xs text-[var(--muted-foreground)]" onClick={() => void workbench.refresh().catch((reason) => workbench.setError(String(reason)))}>새로고침</button></div>
      {!workbench.workspaces.length && <p className="py-8 text-sm text-[var(--muted-foreground)]">작업 폴더를 열면 여기에 표시됩니다.</p>}
      {workbench.workspaces.map((workspace) => <div key={workspace.id} className="flex items-center border-b border-[var(--border)] py-2">
        <button className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left hover:bg-[var(--muted)]" disabled={workbench.busy} onClick={() => void workbench.openFolder(false, workspace)}>
          <FolderOpen size={18} className="shrink-0 text-[var(--brand)]" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{workspace.name}{!workspace.available && " · 폴더 찾기"}</span><span className="block truncate text-xs text-[var(--muted-foreground)]">{workspace.path}</span></span>
        </button>
        {workspace.available && <button title="Windows 파일 탐색기에서 폴더 이름을 변경하거나 이동" aria-label={`${workspace.name} 이름 변경 또는 이동`} disabled={workbench.busy} className="rounded p-2 hover:bg-[var(--muted)] disabled:opacity-40" onClick={() => void workbench.relocate(workspace)}><MoreHorizontal size={16} /></button>}
      </div>)}
    </div>
  </div>
}
