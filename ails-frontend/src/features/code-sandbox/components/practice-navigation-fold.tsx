import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import "./practice-navigation-fold.css"

export function PracticeNavigationFoldButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = t(collapsed ? "문제 탐색 펼치기" : "문제 탐색 접기")
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return <button type="button" data-practice-navigation-toggle aria-label={label} title={label} aria-expanded={!collapsed}
    className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
    onClick={event => {
      const panel = event.currentTarget.closest("[data-practice-navigation-panel]")
      onToggle()
      requestAnimationFrame(() => panel?.querySelector<HTMLButtonElement>("[data-practice-navigation-toggle]")?.focus({ preventScroll: true }))
    }}><Icon size={14} /></button>
}

export function PracticeNavigationRail({ number, onToggle }: { number?: number; onToggle: () => void }) {
  return <div className="flex h-full w-12 flex-col items-center gap-3 py-3" data-practice-navigation-rail>
    <PracticeNavigationFoldButton collapsed onToggle={onToggle} />
    {number != null && <span className="text-xs text-[var(--muted-foreground)]">{number}</span>}
  </div>
}
