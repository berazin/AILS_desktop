import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import { PracticeActionsMenu } from "./practice-actions-menu.tsx"

export function PracticeNavigatorQuestionRow({
  active, answerType, disabled = false, label, meta, onSelect, status, statusLabel, title,
}: {
  active: boolean
  answerType: string
  disabled?: boolean
  label: string
  meta: string
  onSelect: () => void
  status: string
  statusLabel: string
  title?: string
}) {
  return <button
    aria-current={active ? "true" : undefined}
    className={`block min-w-0 flex-1 rounded-md border-l-2 px-2 py-2 text-left transition-colors ${active
      ? "border-l-[var(--brand)] bg-[var(--brand-soft)] text-[var(--foreground)] ring-1 ring-inset ring-[var(--border)] font-bold"
      : "border-l-transparent text-[var(--foreground)]/80 hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]"}`}
    disabled={disabled}
    onClick={onSelect}
    title={title}
    type="button"
  >
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "completed" ? "bg-emerald-500" : status === "retry" ? "bg-amber-500" : status === "in_progress" ? "bg-sky-500" : "bg-[var(--muted-foreground)]/40"}`} />
      <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[var(--foreground)]">{label}</span>
      {meta && <span className="shrink-0 text-[9px] font-medium text-[var(--muted-foreground)]">{meta}</span>}
    </span>
    <span className="mt-0.5 flex items-center justify-between gap-1 pl-3 text-[9px]">
      <span className="truncate font-medium text-[var(--muted-foreground)]">{answerType}</span>
      <span className="shrink-0 font-medium text-[var(--muted-foreground)]">{statusLabel}</span>
    </span>
  </button>
}

export function PracticeStudyToolbar({ heading, status, statusTone = "new", meta, metaTitle, leadingAction, secondaryActions, onSecondaryClose, children }: {
  heading: string
  status: string
  statusTone?: string
  meta?: string
  metaTitle?: string
  leadingAction?: ReactNode
  secondaryActions?: ReactNode
  onSecondaryClose?: () => void
  children: ReactNode
}) {
  return <div className="ails-practice-study-toolbar relative flex min-h-10 shrink-0 items-center border-b border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-[var(--foreground)]" data-problem-study-panel="true">
    <div data-practice-toolbar-grid className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
      <div data-practice-toolbar-summary className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-bold text-[var(--foreground)]" title={heading}>{heading}</span>
        <span className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 font-bold ${statusTone === "completed" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : statusTone === "retry" ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300" : statusTone === "in_progress" ? "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300" : "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>{status}</span>
        {meta && <span data-problem-study-meta className="truncate font-medium text-[var(--muted-foreground)]" title={metaTitle ?? meta}>{meta}</span>}
        {leadingAction}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1" data-problem-toolbar-actions="true">{children}{secondaryActions && <PracticeActionsMenu onClose={onSecondaryClose}>{secondaryActions}</PracticeActionsMenu>}</div>
    </div>
  </div>
}

export function PracticeStepButton({ direction, disabled, onClick }: {
  direction: "previous" | "next"
  disabled: boolean
  onClick: () => void
}) {
  const label = direction === "previous" ? t("이전 문제") : t("다음 문제")
  const shortcut = direction === "previous" ? "Alt+←" : "Alt+→"
  return <button aria-label={label} className="code-sandbox-button w-8 px-0" disabled={disabled} onClick={onClick} title={`${label} (${shortcut})`} type="button">
    {direction === "previous" ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
  </button>
}
