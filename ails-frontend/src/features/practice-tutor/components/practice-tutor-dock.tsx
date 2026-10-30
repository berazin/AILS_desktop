import type { ReactNode } from "react"
import { PanelDivider } from "../../../shared/components/panel-divider.tsx"
import { usePracticeTutor } from "../practice-tutor-provider.tsx"
import "./practice-tutor.css"

export function PracticeTutorDock({ children }: { children: ReactNode }) {
  const tutor = usePracticeTutor()
  if (!tutor?.everOpened || !tutor.layout) return null
  const { dock, mode } = tutor.layout
  const visible = tutor.open && Boolean(tutor.context)
  const showTabs = mode !== "wide" && mode !== "column" && tutor.context?.source_kind === "pdf"
  return <>
    {visible && mode !== "stacked" && mode !== "column" && tutor.context?.source_kind === "pdf" && <div data-practice-tutor-divider={mode} className="fixed z-[96] flex" style={{ left: tutor.layout.split.splitX - 2, top: 32, height: dock.height }}>
      <PanelDivider label="문제풀이와 보조 패널 너비" vertical value={tutor.layout.split.splitX} onChange={tutor.resizeSolution} />
    </div>}
    {visible && showTabs && <nav className="fixed z-[96] flex h-8 border-b border-[var(--border)] bg-[var(--panel)] text-xs" aria-label="문제풀이 보조 패널"
      style={{ left: dock.x, top: dock.y, width: dock.width }}>
      {([['pdf', 'PDF'], ['chat', 'AI 튜터']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={tutor.tab === id}
        className="flex-1 aria-pressed:bg-[var(--muted)]" onClick={() => tutor.setTab(id)}>{label}</button>)}
    </nav>}
    {visible && mode === "wide" && <div data-practice-tutor-divider className="fixed z-[96] flex" style={{ left: dock.x - 3, top: dock.y, height: dock.height }}>
      <PanelDivider label={tutor.context?.source_kind === "summary" ? "문제풀이와 AI 튜터 너비" : "PDF와 AI 튜터 너비"} vertical reverse value={tutor.layout.dock.width} onChange={tutor.resize} />
    </div>}
    <aside aria-label="AI 튜터" className="ails-practice-tutor fixed z-[95] min-h-0 min-w-0 overflow-hidden border-l border-[var(--border)] bg-[var(--panel)]"
      data-practice-tutor-mode={mode} style={{ left: dock.x, top: dock.y + (showTabs ? 32 : 0), width: dock.width,
        borderLeftWidth: mode === "tabs" ? 0 : undefined,
        height: Math.max(0, dock.height - (showTabs ? 32 : 0)), display: visible && (!showTabs || tutor.tab === "chat") ? undefined : "none" }}>
      {children}
    </aside>
  </>
}
