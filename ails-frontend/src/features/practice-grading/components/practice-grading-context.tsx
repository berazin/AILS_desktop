import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { ClipboardList, Loader2, RefreshCw, X } from "lucide-react"
import { MAX_GRADING_CONTEXT_CHARS, type GradingContextSource } from "../../../lib/api/practice-grading-context.ts"
import { usePracticeGradingContext } from "../hooks/use-practice-grading-context.ts"

export function PracticeGradingContext({ active, disabled = false, rootRef, ...source }: GradingContextSource & { active: boolean; disabled?: boolean; rootRef: RefObject<HTMLElement | null> }) {
  // A distinct source mounts with a distinct key in each solving window. Drafts
  // and late save responses can therefore never be applied to another source.
  const context = usePracticeGradingContext(source, active)
  const input = useRef<HTMLTextAreaElement>(null)
  const edit = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setPortalRoot(rootRef.current) }, [rootRef, active, context.open])
  useEffect(() => {
    if (!active || !context.open) return
    const previous = document.activeElement
    input.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [active, context.open, portalRoot])
  if (!active) return null
  const initial = !context.record?.acknowledged
  const close = () => { if (!context.saving) context.cancel() }
  return <>
    <div data-practice-grading-context className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
      {context.error && !context.open && <span role="status" className="sr-only">{context.error}</span>}
      {context.error && <button type="button" aria-label="채점 문맥 다시 불러오기" title={context.error} className="code-sandbox-button text-red-500" onClick={context.reload} disabled={context.saving}><RefreshCw size={12} /></button>}
      <button ref={edit} type="button" aria-label="AI 채점 문맥 수정" title={context.loading ? "채점 문맥 확인 중…" : context.record?.text || "AI 채점에 참고할 추가 문맥 설정"}
        className={`code-sandbox-button ${context.record?.text ? "text-[var(--brand)]" : ""}`} disabled={disabled || context.loading || !context.record} onClick={context.edit}>
        {context.loading ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />}<span>채점 문맥</span>{context.record?.text && <i aria-label="문맥 사용 중" className="h-1 w-1 rounded-full bg-[var(--brand)]" />}
      </button>
    </div>
    {context.open && portalRoot && createPortal(<div data-practice-grading-context-dialog className="absolute inset-0 z-[250] flex items-center justify-center bg-black/25 p-3"
      onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === "Escape") { event.preventDefault(); close() }
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)'))
          const first = controls[0], last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
      <form role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-xl"
        onSubmit={event => { event.preventDefault(); void context.save(context.draft) }}>
        <div className="flex items-center justify-between gap-2"><h3 id={titleId} className="text-sm font-semibold">{initial ? "채점에 필요한 추가 문맥이 있나요?" : "AI 채점 문맥 수정"}</h3><button type="button" aria-label="채점 문맥 닫기" disabled={context.saving} onClick={close}><X size={16} /></button></div>
        <p className="text-xs leading-5 text-[var(--muted-foreground)]">과목, 사용하는 언어·버전, 수업에서 정한 전제처럼 채점에 꼭 필요한 내용을 적어 주세요. 입력한 내용은 이 자료의 AI 채점에 함께 전달됩니다.</p>
        <textarea ref={input} aria-label="AI 채점 추가 문맥" maxLength={MAX_GRADING_CONTEXT_CHARS} value={context.draft} onChange={event => context.setDraft(event.target.value)} disabled={context.saving}
          className="min-h-28 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm outline-none"
          placeholder={"예: 객체지향프로그래밍 수업이며 Java 17 기준입니다. 수업에서 별도 언급이 없으면 단일 스레드를 가정합니다."} />
        <div className="flex justify-between gap-2 text-[10px] text-[var(--muted-foreground)]"><span>문제·답지의 명시된 조건을 우선합니다. 변경은 이후 AI 채점부터 적용됩니다.</span><span className="shrink-0">{context.draft.length}/{MAX_GRADING_CONTEXT_CHARS}</span></div>
        {context.error && <p role="alert" className="text-xs text-red-500">{context.error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {!initial && <button type="button" disabled={context.saving} onClick={close} className="code-sandbox-button">취소</button>}
          <button type="button" disabled={context.saving} onClick={() => void context.save("")} className="code-sandbox-button">{initial ? "추가 문맥 없음" : "문맥 삭제"}</button>
          <button type="submit" disabled={context.saving || !context.draft.trim()} className="code-sandbox-button border-[var(--brand)] text-[var(--brand)]">{context.saving && <Loader2 size={12} className="animate-spin" />}{initial ? "저장하고 시작" : "저장"}</button>
        </div>
      </form>
    </div>, portalRoot)}
  </>
}
