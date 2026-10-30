import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Button } from "../../shared/ui/button.tsx"
import { useInsightBook } from "./use-insight-book.ts"

function positionInput(form: HTMLFormElement | null, anchor: HTMLButtonElement | null) {
  if (!form || !anchor) return
  const bounds = anchor.getBoundingClientRect()
  const width = Math.min(384, window.innerWidth - 16)
  form.style.width = `${width}px`
  form.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`
  form.style.top = `${bounds.bottom + 6}px`
}

export function InsightInputDialog({ anchorRef, id, onClose }: { anchorRef: RefObject<HTMLButtonElement | null>; id: string; onClose: () => void }) {
  const { error, busy, submit } = useInsightBook({ mode: "submit" })
  const [draft, setDraft] = useState("")
  const form = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const mounted = useRef(false)

  useLayoutEffect(() => { positionInput(form.current, anchorRef.current) })
  useEffect(() => {
    const reposition = () => positionInput(form.current, anchorRef.current)
    window.addEventListener("resize", reposition)
    return () => window.removeEventListener("resize", reposition)
  }, [anchorRef])

  useLayoutEffect(() => {
    mounted.current = true
    const anchor = anchorRef.current
    const focusInput = () => input.current?.focus({ preventScroll: true })
    const suppressOpeningInput = (event: InputEvent) => {
      if (event.cancelable && (event.data === "ㅑ" || event.data === "i")) event.preventDefault()
    }
    const finishOpeningKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyI" && !["i", "ㅑ", "Process"].includes(event.key)) return
      clearOpeningKey()
      focusInput()
    }
    const clearOpeningKey = () => {
      if (anchor) delete anchor.dataset.ailsInsightOpeningKey
      window.removeEventListener("keyup", finishOpeningKey, true)
      window.removeEventListener("blur", clearOpeningKey)
      document.removeEventListener("beforeinput", suppressOpeningInput, true)
    }
    if (anchor?.dataset.ailsInsightOpeningKey === "true") {
      window.addEventListener("keyup", finishOpeningKey, true)
      window.addEventListener("blur", clearOpeningKey)
      document.addEventListener("beforeinput", suppressOpeningInput, true)
    } else focusInput()
    return () => { mounted.current = false; clearOpeningKey() }
  }, [anchorRef])

  function close() {
    if (form.current?.contains(document.activeElement)) anchorRef.current?.focus({ preventScroll: true })
    onClose()
  }

  return createPortal(
    <form ref={form} id={id} role="dialog" aria-label="Insight" data-ails-insight-input="true"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
      className="fixed z-[180] max-h-[calc(100vh-48px)] space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--foreground)] shadow-xl motion-safe:animate-[ails-slide-fade-in_180ms_cubic-bezier(0.22,1,0.36,1)_both]"
      onSubmit={event => {
        event.preventDefault()
        if (busy || !draft.trim()) return
        void submit(draft).then(ok => { if (ok && mounted.current) close() })
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.altKey || event.metaKey || event.shiftKey) return
        const toggleKey = event.ctrlKey && (event.key.toLowerCase() === "i" || event.key === "ㅑ" || event.code === "KeyI")
        const escapeKey = !event.ctrlKey && event.key === "Escape" && event.nativeEvent.keyCode !== 229
        if (toggleKey || escapeKey) {
          event.preventDefault()
          event.stopPropagation()
          if (!event.repeat) close()
        }
      }}>
      <h2 className="text-sm font-semibold">Insight</h2>
      <textarea ref={input} aria-label="Insight 입력" rows={3} maxLength={10000} required disabled={busy}
        className="block w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm outline-none focus:ring-1 focus:ring-[var(--brand)]"
        placeholder="떠오른 생각을 입력하세요…" value={draft} onChange={event => setDraft(event.target.value)} />
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={close}>닫기</Button>
        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>{busy ? "등록 중…" : "등록"}</Button>
      </div>
    </form>, document.body,
  )
}
