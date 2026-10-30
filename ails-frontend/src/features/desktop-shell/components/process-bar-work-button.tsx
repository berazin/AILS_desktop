import { ListTodo } from "lucide-react"
import { t } from "../../../lib/i18n.ts"

export function ProcessBarWorkButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null
  return <button type="button" onClick={onOpen} aria-label={t("작업 목록")} title={t("작업 목록")}
    className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-normal text-[var(--muted-foreground)] transition-colors hover:bg-[var(--brand)] hover:text-white">
    <ListTodo size={14} /><span className="tabular-nums">{count}</span>
  </button>
}
