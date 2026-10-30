import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { t } from "../../../lib/i18n.ts"
import type { PracticeSolveRound } from "../../../lib/api.ts"
import { History } from "lucide-react"

export function PracticeRoundHistory({ count, load }: {
  count: number
  load: () => Promise<{ rounds: PracticeSolveRound[] }>
}) {
  const [rounds, setRounds] = useState<PracticeSolveRound[] | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const root = useRef<HTMLDetailsElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  const pending = useRef(false)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!root.current || !panel.current) return
      const anchor = root.current.getBoundingClientRect(), bounds = panel.current.getBoundingClientRect()
      setPosition({ left: Math.max(8, Math.min(innerWidth - bounds.width - 8, anchor.right - bounds.width)),
        top: anchor.bottom + bounds.height + 8 <= innerHeight ? anchor.bottom + 6 : Math.max(8, anchor.top - bounds.height - 6) })
    }
    place()
    const observer = new ResizeObserver(place)
    if (panel.current) observer.observe(panel.current)
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true) }
  }, [open, rounds, loading, error])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !panel.current?.contains(event.target) && root.current) root.current.open = false
    }
    document.addEventListener("pointerdown", outside, true)
    return () => document.removeEventListener("pointerdown", outside, true)
  }, [open])
  return <details ref={root} className="relative text-xs" data-practice-round-history="true" onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); if (root.current) root.current.open = false }
  }} onToggle={event => {
    if (event.target !== event.currentTarget) return
    setOpen(event.currentTarget.open)
    if (!event.currentTarget.open || pending.current || rounds) return
    pending.current = true
    setLoading(true)
    setError("")
    void load().then(result => setRounds(result.rounds)).catch(reason => setError(String(reason instanceof Error ? reason.message : reason)))
      .finally(() => { pending.current = false; setLoading(false) })
  }}>
    <summary className="code-sandbox-button cursor-pointer list-none whitespace-nowrap" aria-label={t("풀이 기록")} aria-expanded={open} aria-controls={id}><History size={12} /><span>{t("풀이 기록")} ({count})</span></summary>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={t("풀이 기록")} data-practice-round-history-panel="true" style={position} className="fixed z-[250] max-h-[60vh] w-[min(420px,75vw)] overflow-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--foreground)] shadow-xl">
      {loading && <p role="status">{t("불러오는 중...")}</p>}
      {error && <p role="alert">{error}</p>}
      {rounds?.length === 0 && <p>{t("풀이 기록이 없습니다.")}</p>}
      {rounds?.map(round => <details key={round.id} className="mb-2 rounded border border-[var(--border)] p-2" data-solve-round={round.number}>
        <summary className="cursor-pointer font-semibold">{round.number}{t("회차")} · {round.grading?.correct === true ? t("정답") : round.grading?.correct === false ? t("오답") : t("미채점")} · {Math.floor(round.elapsed_seconds / 60)}{t("분")} {round.elapsed_seconds % 60}{t("초")}</summary>
        {round.graded_at && <p className="my-2 text-[var(--muted-foreground)]">{new Date(round.graded_at).toLocaleString()}</p>}
        {round.question_text && <p className="my-2 whitespace-pre-wrap">{round.question_text}</p>}
        <div className="my-2 font-semibold">{t("제출 답안")}</div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2">{round.selected_answer || round.answer_text || (round.files?.length ? "" : t("저장된 답안이 없습니다."))}</pre>
        {round.files?.map(file => <details key={file.name} className="my-2"><summary className="cursor-pointer">{file.name}</summary><pre className="max-h-64 overflow-auto rounded bg-[var(--muted)] p-2">{file.code}</pre></details>)}
        {round.workspace_path && <p className="my-2 break-all text-[var(--muted-foreground)]">{round.workspace_path}</p>}
        {round.grading?.feedback && <p className="my-2 whitespace-pre-wrap">{round.grading.feedback}</p>}
        {round.grading?.explanation && <p className="my-2 whitespace-pre-wrap">{round.grading.explanation}</p>}
      </details>)}
    </div>, document.body)}
  </details>
}
