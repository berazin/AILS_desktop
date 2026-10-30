import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ArrowRight, ChevronRight, FolderTree, Pencil } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { LectureMaterialFolder } from "../../../lib/api"
import { resolveWorkspaceFolderInput, workspaceBreadcrumbs, workspaceRelativePath } from "../lib/workspace-path.ts"

export function HomeWorkspacePathBar({ rootPath, folderPath, folders, onNavigate }: {
  rootPath: string
  folderPath: string
  folders: readonly LectureMaterialFolder[]
  onNavigate: (path: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState("")
  const errorId = useId()
  const editButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (draft === null && restoreFocus.current) {
      editButton.current?.focus()
      restoreFocus.current = false
    }
  }, [draft])
  const crumbs = useMemo(() => workspaceBreadcrumbs(rootPath, folderPath, folders), [rootPath, folderPath, folders])
  const relative = workspaceRelativePath(rootPath, folderPath) ?? ""
  const startEditing = () => { setError(""); setDraft(relative.replace(/\//g, "\\") || ".") }
  const cancelEditing = () => { restoreFocus.current = true; setDraft(null); setError("") }
  const buttonClass = "flex shrink-0 items-center gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--interactive-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--brand)]"

  return <div className="shrink-0 px-6 pb-1 pt-3" data-ails-home-path-bar="true">
    {draft !== null ? <form className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-[var(--brand)] bg-[var(--background)] px-2 text-[var(--foreground)]"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDraft(null); setError("") } }}
      onSubmit={event => {
        event.preventDefault()
        event.stopPropagation()
        const result = resolveWorkspaceFolderInput(draft, rootPath, folders)
        if (result.error) {
          setError(result.error === "outside" ? t("작업공간 안의 경로를 입력해 주세요.") : t("폴더를 찾을 수 없습니다."))
          return
        }
        setDraft(null)
        setError("")
        onNavigate(result.path)
      }}>
      <FolderTree size={16} className="shrink-0 text-[var(--muted-foreground)]" />
      <input autoFocus className="min-w-0 flex-1 bg-transparent text-xs outline-none" aria-label={t("작업공간 경로 입력")}
        aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        placeholder={t("작업공간 기준 경로")} value={draft} onFocus={event => event.currentTarget.select()}
        onChange={event => { setDraft(event.target.value); setError("") }}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === "Escape") { event.preventDefault(); cancelEditing() }
          if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault()
        }} />
      <button type="submit" className={buttonClass} aria-label={t("입력한 경로로 이동")}><ArrowRight size={15} /></button>
    </form> : <nav aria-label={t("현재 작업공간 경로")} className="flex h-9 min-w-0 items-center overflow-hidden rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[var(--foreground)]">
      <div className="flex min-w-0 items-center overflow-x-auto">
        <button type="button" className={buttonClass} title={t("작업공간 루트")} aria-current={crumbs.length ? undefined : "location"} disabled={!rootPath} onClick={() => onNavigate("")}>
          <FolderTree size={16} className="shrink-0 text-[var(--muted-foreground)]" />{t("작업공간")}
        </button>
        {crumbs.map((crumb, index) => <span key={crumb.path} className="flex shrink-0 items-center">
          <ChevronRight size={14} className="mx-1 text-[var(--muted-foreground)]" />
          <button type="button" className={`${buttonClass} max-w-60`} title={crumb.label} disabled={!crumb.available}
            aria-current={index === crumbs.length - 1 ? "location" : undefined} data-ails-path-segment={crumb.path}
            onClick={() => index === crumbs.length - 1 ? startEditing() : onNavigate(crumb.path)}><span className="truncate">{crumb.label}</span></button>
        </span>)}
      </div>
      <button ref={editButton} type="button" className="flex h-full min-w-9 flex-1 items-center justify-end rounded px-2 text-[var(--muted-foreground)] hover:bg-[var(--interactive-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--brand)]"
        aria-label={t("경로 입력")} title={t("경로를 입력해 이동")} disabled={!rootPath} onClick={startEditing}><Pencil size={13} /></button>
    </nav>}
    {error && <p id={errorId} role="alert" className="mt-1 text-xs text-red-500">{error}</p>}
  </div>
}
