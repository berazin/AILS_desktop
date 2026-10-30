import type { MouseEvent, ReactNode } from "react"
import { ClipboardList, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import "./practice-window.css"

export function PracticeWindowHeader({ title, meta, onDrag, onClose, children }: {
  title?: string; meta?: ReactNode; onDrag?: (event: MouseEvent) => void; onClose: () => void; children?: ReactNode
}) {
  return <header className="ails-practice-window-toolbar" data-practice-window-header="true" onMouseDown={onDrag}>
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ClipboardList size={14} className="shrink-0 text-[var(--muted-foreground)]" />
      <span className="shrink-0 font-medium">{t("문제풀이")}</span>
      {title && <span className="min-w-0 truncate text-[var(--muted-foreground)]" title={title}>{title}</span>}
    </div>
    <div className="flex min-w-0 shrink-0 items-center gap-1" onMouseDown={event => event.stopPropagation()}>
      {meta && <span className="mr-2 text-[var(--muted-foreground)]">{meta}</span>}
      {children}
      <button type="button" aria-label={t("문제풀이 닫기")} title={t("문제풀이 닫기")} onClick={onClose}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-[var(--muted)]"><X size={14} /></button>
    </div>
  </header>
}
