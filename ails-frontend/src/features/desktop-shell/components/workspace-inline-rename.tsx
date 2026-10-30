import { useLayoutEffect, useRef, useState } from "react"
import { t } from "../../../lib/i18n.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import type { MaterialItem } from "../hooks/use-materials-listing.ts"
import type { WorkspaceRenameAction } from "../lib/workspace-rename.ts"

export function WorkspaceInlineRename({ item, onRename, onFinish, onError, className = "" }: {
  item: MaterialItem; onRename: WorkspaceRenameAction
  onFinish: (oldPath: string, newPath: string, focus: boolean, cancelled?: boolean) => void
  onError: (message: string) => void; className?: string
}) {
  const originalName = item.path.split(/[\\/]/).pop() || item.title
  const isFolder = item.kind === "folder"
  const [name, setName] = useState(originalName), [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null), running = useRef(false), closed = useRef(false), composing = useRef(false)
  const finish = useEventCallback(onFinish), reportError = useEventCallback(onError)
  useLayoutEffect(() => {
    const node = input.current!
    node.focus({ preventScroll: true })
    const dot = originalName.lastIndexOf(".")
    node.setSelectionRange(0, !isFolder && dot > 0 ? dot : originalName.length)
  }, [isFolder, originalName])

  function close(path: string, focus: boolean, cancelled = false) {
    closed.current = true
    finish(item.path, path, focus, cancelled)
  }
  async function save(focus: boolean) {
    if (running.current || closed.current || composing.current || (!focus && error)) return
    const nextName = name.trim()
    if (!nextName || nextName === "." || nextName === ".." || /[\\/:*?"<>|]/.test(nextName)) {
      const message = isFolder ? t("올바른 폴더 이름을 입력하세요.") : t("올바른 파일 이름을 입력하세요.")
      setError(message); reportError(message); input.current?.focus({ preventScroll: true }); return
    }
    if (nextName === originalName) { close(item.path, focus); return }
    running.current = true; setBusy(true); setError(""); reportError("")
    try {
      const result = await onRename({ path: item.path, title: item.title, kind: item.kind, newName: nextName })
      if (result?.error) throw new Error(result.error)
      if (result?.warning) reportError(result.warning)
      close(result?.path || item.path.replace(/[^\\/]+$/, () => nextName), focus)
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      setError(message); reportError(`${item.title}: ${message}`); input.current?.focus({ preventScroll: true })
    } finally { running.current = false; setBusy(false) }
  }

  return <input ref={input} data-ails-workspace-inline-rename aria-label={isFolder ? t("폴더 이름") : t("파일 이름")} aria-invalid={Boolean(error)} aria-busy={busy}
    value={name} title={error || originalName} spellCheck={false} readOnly={busy}
    className={`h-5 min-w-0 w-full cursor-text select-text rounded border border-[var(--brand)] bg-[var(--background)] px-1 text-xs text-[var(--foreground)] outline-none ${className}`}
    onChange={event => { setName(event.target.value); setError(""); reportError("") }}
    onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
    onBlur={() => { void save(false) }} onKeyDown={event => {
      event.stopPropagation()
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return
      if (event.key === "Enter") { event.preventDefault(); void save(true) }
      else if (event.key === "Escape") { event.preventDefault(); if (!running.current) { reportError(""); close(item.path, true, true) } }
    }} />
}
