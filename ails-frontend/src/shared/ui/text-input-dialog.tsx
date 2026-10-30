import { useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { Button } from "./button.tsx"

export type TextInputRequest = {
  title: string
  initialValue?: string
  description?: string
  validate?: (value: string) => string
  resolve: (value: string | null) => void
}

export function TextInputDialog({ input }: { input: TextInputRequest | null }) {
  const dialog = useRef<HTMLDialogElement | null>(null)
  const field = useRef<HTMLInputElement | null>(null)
  useLayoutEffect(() => {
    if (!input) return
    dialog.current?.showModal()
    field.current?.select()
  }, [input])
  if (!input) return null

  return createPortal(<dialog ref={dialog} aria-label={input.title}
    className="m-auto w-[min(420px,calc(100vw-32px))] rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 text-[var(--foreground)] shadow-2xl backdrop:bg-black/35"
    onCancel={(event) => { event.preventDefault(); input.resolve(null) }}>
    <form onSubmit={(event) => {
      event.preventDefault()
      const value = field.current!.value.trim()
      const error = !value ? "값을 입력하세요." : input.validate?.(value) || ""
      field.current!.setCustomValidity(error)
      if (field.current!.reportValidity()) input.resolve(value)
    }}>
      <h2 className="text-sm font-semibold">{input.title}</h2>
      {input.description && <p className="mt-2 break-all text-xs text-[var(--muted-foreground)]">{input.description}</p>}
      <input ref={field} autoFocus aria-label={input.title} defaultValue={input.initialValue ?? ""} spellCheck={false}
        onInput={(event) => event.currentTarget.setCustomValidity("")}
        className="mt-4 h-10 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-[var(--brand)]" />
      <div className="mt-4 flex justify-end gap-2 text-xs">
        <Button type="button" size="sm" variant="outline" onClick={() => input.resolve(null)}>취소</Button>
        <Button type="submit" size="sm">확인</Button>
      </div>
    </form>
  </dialog>, document.body)
}
