import { FilePlus2, X } from "lucide-react"
import { useEffect, useRef, type FormEvent } from "react"
import { t } from "../../../lib/i18n.ts"
import type { SandboxFile } from "../lib/code-sandbox-support.ts"

export function PracticeCodeFiles({ files, activeFileId, onSelect, adding, onAddingChange,
  name, onNameChange, onAdd, disabled, error }: {
  files: SandboxFile[]
  activeFileId: string
  onSelect: (id: string) => void
  adding: boolean
  onAddingChange: (adding: boolean) => void
  name: string
  onNameChange: (name: string) => void
  onAdd: (event: FormEvent) => Promise<void>
  disabled: boolean
  error?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])
  return (
    <div className="ails-code-layout-border-subtle sticky top-0 z-10 shrink-0 border-b bg-[var(--practice-panel)] px-3 py-2" data-practice-code-files>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label={t("코드 답안 파일")}>
          {files.length ? files.map(file => (
            <button key={file.id} type="button" aria-pressed={activeFileId === file.id}
              className={`shrink-0 rounded px-2 py-1 text-xs ${activeFileId === file.id ? "bg-[var(--muted)] font-bold text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}
              disabled={disabled} onClick={() => onSelect(file.id)} title={file.name}>
              {file.name}{file.code !== file.savedCode ? " *" : ""}
            </button>
          )) : <span className="text-xs text-[var(--muted-foreground)]">{t("코드 답안 파일이 없습니다.")}</span>}
        </div>
        <button className="code-sandbox-button shrink-0" type="button" disabled={disabled}
          aria-label={t("코드 답안 파일 추가")} onClick={() => onAddingChange(true)}>
          <FilePlus2 size={13} />{t("새 파일")}
        </button>
      </div>
      {adding && <form className="mt-2 flex items-center gap-2" onSubmit={event => void onAdd(event)}>
        <input ref={inputRef} aria-label={t("새 코드 파일 이름")} placeholder="main.c" value={name}
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--practice-editor)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
          spellCheck={false} disabled={disabled} onChange={event => onNameChange(event.target.value)}
          onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onAddingChange(false) } }} />
        <button className="code-sandbox-button" type="submit" disabled={disabled || !name.trim()}>{t("파일 만들기")}</button>
        <button className="code-sandbox-button" aria-label={t("파일 추가 취소")} type="button" onClick={() => onAddingChange(false)}><X size={12} /></button>
      </form>}
      {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  )
}
