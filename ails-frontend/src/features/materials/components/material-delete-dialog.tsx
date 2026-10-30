import { Loader2, Trash2, X } from "lucide-react"
import { useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"

import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

export function MaterialDeleteDialog({
  busy,
  confirmLabel = t("삭제"),
  description,
  onCancel,
  onConfirm,
  summary,
  title,
  titleId,
}: {
  busy: boolean
  confirmLabel?: string
  description: string
  onCancel: () => void
  onConfirm: () => void
  summary: string
  title: string
  titleId: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    cancelRef.current?.focus()
    return () => dialog.close()
  }, [])

  return createPortal(
    <dialog
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-description ${titleId}-summary`}
      aria-modal="true"
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 text-[var(--foreground)] shadow-2xl backdrop:bg-black/40"
      onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key !== "Tab") return
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (!buttons.length || index < 0 || (event.shiftKey ? index === 0 : index === buttons.length - 1)) {
          event.preventDefault()
          buttons[event.shiftKey ? buttons.length - 1 : 0]?.focus()
        }
      }}
      ref={dialogRef}
      role="dialog"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <p id={`${titleId}-description`} className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{description}</p>
        </div>
        <Button aria-label={t("취소")} disabled={busy} onClick={onCancel} size="icon" type="button" variant="ghost"><X size={18} /></Button>
      </div>
      <div id={`${titleId}-summary`} className="rounded-lg bg-[var(--muted)] p-3 text-sm font-medium">{summary}</div>
      <p className="mt-4 text-sm text-[var(--muted-foreground)]">{t("계속할까요?")}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} ref={cancelRef} type="button" variant="outline">{t("취소")}</Button>
        <Button
          className="bg-red-600 text-white hover:bg-red-700"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          {busy ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
          {confirmLabel}
        </Button>
      </div>
    </dialog>,
    document.body,
  )
}
