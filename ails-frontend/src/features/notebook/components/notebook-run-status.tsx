import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react"

export function NotebookRunStatus({ progress, onLocate }: {
  progress: { completed: number; total: number; currentCellIndex: number; phase: "running" | "complete" | "failed" | "cancelled" }
  onLocate: (index: number) => void
}) {
  const running = progress.phase === "running"
  const failed = progress.phase === "failed"
  const label = running ? "전체 실행 중" : progress.phase === "complete" ? "전체 실행 완료" : failed ? "오류로 중단" : "실행 취소됨"
  return <div data-notebook-run-status className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-3 py-2 text-xs" role="status" aria-live="polite">
    {running ? <Loader2 size={14} className="animate-spin" /> : failed ? <CircleAlert size={14} className="text-red-500" /> : <CheckCircle2 size={14} />}
    <span>{label} · {progress.completed}/{progress.total} 셀</span>
    <progress aria-label="코드 셀 실행 진행률" className="h-1.5 min-w-16 max-w-48 flex-1 accent-[var(--brand)]" value={progress.completed} max={Math.max(1, progress.total)} />
    {progress.phase !== "complete" && <button type="button" className="underline underline-offset-2" onClick={() => onLocate(progress.currentCellIndex)}>{progress.currentCellIndex + 1}번 셀로 이동</button>}
  </div>
}
