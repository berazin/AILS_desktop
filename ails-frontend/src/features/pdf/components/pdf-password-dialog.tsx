import { FileText, Loader2, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"

export function PdfPasswordDialog({
  busy,
  error,
  onCancel,
  onPasswordChange,
  onSubmit,
  password,
  path,
  title,
}: {
  busy: boolean
  error: string
  onCancel: () => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  password: string
  path: string
  title: string
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!path || !dialog) return
    dialog.showModal()
    passwordRef.current?.focus()
    return () => dialog.close()
  }, [path])
  if (!path) return null

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="pdf-password-title"
      className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-transparent p-4 text-[var(--foreground)] backdrop:bg-black/40"
      onCancel={(event) => { event.preventDefault(); onCancel() }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="pdf-password-title" className="text-lg font-semibold">{t("PDF 비밀번호")}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {t("비밀번호가 맞으면 이 PDF를 암호 없는 파일로 저장해 다음부터 바로 열 수 있습니다.")}
            </p>
          </div>
          <Button onClick={onCancel} size="icon" type="button" variant="ghost">
            <X size={18} />
          </Button>
        </div>
        <div className="mb-3 rounded-lg bg-[var(--muted)] p-3 text-sm font-medium">{title}</div>
        <Input
          ref={passwordRef}
          autoFocus
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder={t("PDF 비밀번호")}
          type="password"
          value={password}
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="outline">{t("취소")}</Button>
          <Button disabled={busy} type="submit">
            {busy ? <Loader2 className="animate-spin" size={15} /> : <FileText size={15} />}
            {t("열기")}
          </Button>
        </div>
      </form>
    </dialog>,
    document.body,
  )
}
