import type { ReactNode } from "react"
import { ArrowLeft, Code2, FileText, FolderOpen, Loader2, X } from "lucide-react"
import type { FolderWorkbench } from "./use-folder-workbench.ts"
import { SPLIT_PICKER_ID } from "./session.ts"

export function SplitPanePicker({ workbench, workspaceBrowser }: {
  workbench: FolderWorkbench; workspaceBrowser?: ReactNode
}) {
  const files = workbench.splitPickerView === "files"
  const tabs = workbench.tabs.filter((tab) => !workbench.split?.includes(tab.id))
  return <section data-ails-split-picker onPointerDownCapture={() => workbench.focus(SPLIT_PICKER_ID)} className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--background)] text-[var(--foreground)]">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 text-sm">
      {files && <button type="button" aria-label="열린 탭 목록으로 돌아가기" className="rounded p-1 hover:bg-[var(--muted)]" onClick={() => workbench.setSplitPickerView("tabs")}><ArrowLeft size={16} /></button>}
      <span className="min-w-0 flex-1 font-medium">{files ? "열 파일 선택" : "새 분할 화면"}</span>
      {workbench.openingSplitFile && <Loader2 size={15} className="animate-spin" aria-label="파일 여는 중" />}
      <button type="button" aria-label="새 분할 화면 닫기" className="rounded p-1 hover:bg-[var(--muted)]" onClick={() => workbench.close(SPLIT_PICKER_ID)}><X size={16} /></button>
    </header>
    {files ? workspaceBrowser : <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <button type="button" className="mb-6 flex w-full items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3 text-left text-sm hover:bg-[var(--muted)]" onClick={() => workbench.setSplitPickerView("files")}>
        <FolderOpen size={18} className="text-[var(--brand)]" /><span>새로 열기</span>
      </button>
      <h2 className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">열린 탭</h2>
      <div className="space-y-1">
        {tabs.map((tab) => <button key={tab.id} type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-[var(--muted)]" onClick={() => workbench.chooseSplitTab(tab.id)}>
          {tab.kind === "code-workspace" || tab.kind === "ipynb" ? <Code2 size={16} className="shrink-0 text-amber-500" /> : <FileText size={16} className="shrink-0 text-blue-500" />}<span className="truncate">{tab.title}</span>
        </button>)}
        {tabs.length === 0 && <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">다른 열린 탭이 없습니다. 새로 열기에서 파일을 선택하세요.</p>}
      </div>
    </div>}
  </section>
}
