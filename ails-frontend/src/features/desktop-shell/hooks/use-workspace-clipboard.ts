import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react"
import type { MaterialTransferRequest, MaterialTransferResult } from "../../../lib/api/materials.ts"
import { t } from "../../../lib/i18n.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { clearWorkspaceClipboard, readWorkspaceClipboard, subscribeWorkspaceClipboard, workspaceClipboardSnapshot, writeWorkspaceClipboard } from "../lib/workspace-clipboard.ts"
import { workspacePinKey } from "./use-workspace-pins.ts"

function hasSourceAncestor(key: string, sources: ReadonlySet<string>) {
  while (key) {
    if (sources.has(key)) return true
    const separator = key.lastIndexOf("/")
    if (separator < 0) break
    key = key.slice(0, separator)
  }
  return false
}

export function useWorkspaceClipboard({ root, folder, selectedPaths, renameActive, onTransfer, onPasted, onError }: {
  root: string
  folder: string
  selectedPaths: ReadonlySet<string>
  renameActive: boolean
  onTransfer?: (payload: MaterialTransferRequest) => Promise<MaterialTransferResult>
  onPasted: (folder: string, paths: string[]) => void
  onError: (error: string) => void
}) {
  const clipboard = useSyncExternalStore(subscribeWorkspaceClipboard, workspaceClipboardSnapshot, () => null)
  const cutPaths = useMemo(() => new Set(clipboard?.mode === "cut" ? clipboard.paths.map(workspacePinKey) : []), [clipboard])
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const pasted = useEventCallback(onPasted)

  async function copy(mode: "copy" | "cut") {
    onError("")
    await writeWorkspaceClipboard({ version: 1, id: crypto.randomUUID(), mode, root, paths: [...selectedPaths] })
    setNotice(mode === "copy" ? t("{p0}개 항목을 복사했습니다.", { p0: selectedPaths.size })
      : t("{p0}개 항목을 잘라냈습니다. 붙여넣을 폴더로 이동하세요.", { p0: selectedPaths.size }))
  }

  async function paste() {
    const source = await readWorkspaceClipboard()
    if (!source || !onTransfer) return
    if (workspacePinKey(source.root) !== workspacePinKey(root)) throw new Error(t("다른 작업공간의 항목은 붙여넣을 수 없습니다."))
    onError("")
    setNotice(t("항목을 붙여넣는 중…"))
    const result = await onTransfer({ mode: source.mode, paths: source.paths, target_folder_path: folder })
    const completed = result.results.filter(entry => entry.status !== "error" && entry.new_path)
    const paths = completed.map(entry => entry.new_path!)
    const errors = result.results.filter(entry => entry.status === "error").map(entry => `${entry.old_path.split(/[\\/]/).pop()}: ${entry.error}`)
    const warnings = result.results.flatMap(entry => entry.warning ? [entry.warning] : [])
    if (source.mode === "cut") {
      const completedPaths = new Set(completed.map(entry => workspacePinKey(entry.old_path)))
      const remaining = source.paths.filter(path => !hasSourceAncestor(workspacePinKey(path), completedPaths))
      if (remaining.length) await writeWorkspaceClipboard({ ...source, paths: remaining }, source.id)
      else await clearWorkspaceClipboard(source.id)
    }
    pasted(folder, paths)
    onError([...errors, ...warnings].join("\n"))
    setNotice(t("{p0}개 항목을 붙여넣었습니다.", { p0: completed.length }))
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement, key = event.key.toLowerCase()
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || !["c", "x", "v"].includes(key)
      || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || renameActive || target.isContentEditable
      || target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], .monaco-editor")) return false
    if ((key !== "v" && !selectedPaths.size) || !onTransfer) return false
    event.preventDefault(); event.stopPropagation()
    if (pending.current || event.repeat) return true
    pending.current = true
    setBusy(true)
    void (key === "v" ? paste() : copy(key === "x" ? "cut" : "copy"))
      .catch(error => { setNotice(""); onError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { pending.current = false; setBusy(false) })
    return true
  }

  return { busy, notice, onKeyDown, isCut: (path: string) => clipboard?.mode === "cut"
    && workspacePinKey(clipboard.root) === workspacePinKey(root) && hasSourceAncestor(workspacePinKey(path), cutPaths) }
}
