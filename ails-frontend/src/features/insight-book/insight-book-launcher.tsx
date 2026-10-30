import { lazy, Suspense, useId, useRef, useState } from "react"
import { BookOpen } from "lucide-react"
const InsightInputDialog = lazy(() => import("./insight-input-dialog.tsx").then(m => ({ default: m.InsightInputDialog })))
const InsightBookPanel = lazy(() => import("./insight-book-panel.tsx").then(m => ({ default: m.InsightBookPanel })))
type Props = { onClose: () => void; onOpenSource: (path: string, page?: number) => void; materialRoot?: string }

export function InsightBookLauncher({ className, compact = false, onOpenSource }: Omit<Props, "onClose"> & { className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const dialogId = useId()
  return <>
    <button ref={anchor} type="button" className={className} onClick={() => setOpen(current => compact ? !current : true)} title={compact ? "Insight 입력 (Ctrl+I)" : "Insight Book 열기"} data-ails-insight-launcher="true"
      data-ails-insight-shortcut={compact ? "true" : undefined} aria-keyshortcuts={compact ? "Control+i" : undefined}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={compact && open ? dialogId : undefined}>
      <BookOpen size={compact ? 12 : 18} strokeWidth={1.8} /><span className={compact ? "text-xs font-normal" : "text-xs font-semibold"}>{compact ? "Insight" : "Insight Book"}</span>
    </button>
    {open && <Suspense fallback={<p role="status">Insight 화면을 준비하고 있습니다.</p>}>{(compact
      ? <InsightInputDialog anchorRef={anchor} id={dialogId} onClose={() => setOpen(false)} />
      : <InsightBookPanel onClose={() => setOpen(false)} onOpenSource={(path, page) => { setOpen(false); onOpenSource(path, page) }} />)}</Suspense>}
  </>
}
