import { Code2 } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"

export function CodeSandboxNameDialog({
  draft,
  onCancel,
  onChange,
  onSubmit,
  open,
}: {
  draft: string
  onCancel: () => void
  onChange: (value: string) => void
  onSubmit: (fileName: string) => void
  open: boolean
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form
        className="w-full max-w-[420px] rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[var(--foreground)] shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          const fileName = draft.trim().replace(/^[\\/]+/, "")
          if (fileName) onSubmit(fileName)
        }}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--brand)]/20 bg-[var(--brand-soft)]/25 text-[var(--brand)]">
            <Code2 size={19} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold">{t("코드 파일 열기")}</h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{t("확장자를 포함해서 시작할 파일 이름을 입력하세요.")}</p>
          </div>
        </div>
        <label className="mb-1.5 block text-xs font-bold text-[var(--muted-foreground)]" htmlFor="code-sandbox-initial-file">
          {t("파일 이름")}
        </label>
        <Input
          autoFocus
          className="h-10 font-mono text-sm"
          id="code-sandbox-initial-file"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel()
          }}
          placeholder="main.py"
          spellCheck={false}
          value={draft}
        />
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-[var(--muted-foreground)]">{t("예: main.py, hello.cpp, practice.cs")}</span>
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={onCancel} size="sm" type="button" variant="outline">{t("취소")}</Button>
            <Button className="gap-1.5" size="sm" type="submit"><Code2 size={14} />{t("열기")}</Button>
          </div>
        </div>
      </form>
    </div>
  )
}
