import { AppWindow, Code2, Columns2, FileText, House, MessageSquare, Settings2, Ungroup, X } from "lucide-react"
import { cn } from "../../../lib/utils.ts"
import type { ProcessBarTabItem } from "./process-bar-tabs.tsx"
import { LiquidSettingsTabSurface } from "./liquid-settings-tab-surface.tsx"
import { officeTitle, useOfficeRevision } from '../../office/session.ts'

export function ProcessBarDocumentTab({ tab: originalTab, active, paired, selected, canClose = true, selectionManaged = false, hoverPreview = false, onSelect, onClose, onSplit, onUnsplit }: {
  tab: ProcessBarTabItem; active: boolean; paired?: boolean; selected: boolean; canClose?: boolean; selectionManaged?: boolean; hoverPreview?: boolean
  onSelect: (id: string) => void; onClose: (id: string) => void; onSplit?: (id: string) => void; onUnsplit?: (id: string) => void
}) {
  useOfficeRevision()
  const tab = { ...originalTab, title: officeTitle(originalTab.id, originalTab.title) }
  const placeholder = tab.kind === "split-picker"
  const toggleLayout = paired ? onUnsplit : placeholder ? undefined : onSplit
  return <div role="tab" aria-selected={selected} tabIndex={0} data-tab-id={tab.id} data-active={active} data-tab-detached={!paired && tab.kind === "settings"} data-ails-processbar-tab={paired ? undefined : ""}
    title={hoverPreview ? undefined : tab.title} onClick={() => onSelect(tab.id)}
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(tab.id) } }}
    onAuxClick={(event) => { if (canClose && event.button === 1) { event.preventDefault(); onClose(tab.id) } }}
    onMouseDown={(event) => { if (event.button === 1) event.preventDefault() }}
    className={cn("group/tab relative isolate flex h-7 shrink-0 cursor-default select-none items-center gap-1.5 px-2.5 text-xs transition-colors",
      paired ? (active ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]") : "rounded-t-xl border-x border-t",
      !paired && (active ? "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-xs" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"))}>
    {tab.kind === "home" ? <House size={12} data-tab-icon="home" className={active ? "shrink-0 text-[var(--brand)]" : "shrink-0 text-[var(--muted-foreground)]"} />
      : placeholder ? <AppWindow size={13} data-tab-icon="split-picker" className="shrink-0" />
      : tab.kind === "chatbot" ? <MessageSquare size={12} data-tab-icon="chatbot" className="shrink-0" />
      : tab.kind === "settings" ? <Settings2 size={12} data-tab-icon="settings" className="shrink-0" />
      : tab.kind === "code" || tab.kind === "ipynb" || tab.kind === "code-workspace" ? <Code2 size={12} data-tab-icon="code" className={active ? "shrink-0 text-amber-500" : "shrink-0 text-[var(--muted-foreground)]"} />
      : <FileText size={12} data-tab-icon="doc" className={active ? "shrink-0 text-blue-500" : "shrink-0 text-[var(--muted-foreground)]"} />}
    <span data-tab-title className="max-w-[130px] truncate">{tab.title}</span>
    {toggleLayout && <button type="button" data-tab-split={paired ? undefined : true} data-tab-unsplit={paired ? true : undefined}
      className={cn("pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--muted)] group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-visible/tab:pointer-events-auto group-focus-visible/tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
        canClose ? "right-8" : "right-2.5")}
      aria-label={`${tab.title} ${paired ? "분할 해제" : "나란히 보기"}`} title={paired ? "분할 해제" : "분할 화면으로 열기"}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); toggleLayout(tab.id) }}>{paired ? <Ungroup size={12} /> : <Columns2 size={12} />}</button>}
    {canClose && <button type="button" data-tab-close
      className="pointer-events-none absolute right-2.5 top-1/2 z-10 -translate-y-1/2 rounded p-0.5 opacity-0 transition-opacity hover:bg-[var(--muted)] group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-visible/tab:pointer-events-auto group-focus-visible/tab:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
      aria-label={`${tab.title} 탭 닫기`} title="탭 닫기" onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onClose(tab.id) }}><X size={12} /></button>}
    {!paired && !selectionManaged && <LiquidSettingsTabSurface active={active} detached={tab.kind === "settings"} />}
  </div>
}
