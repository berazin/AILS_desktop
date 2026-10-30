type FileDraft = { path: string; text: string; draft: string; revision: string }
type Session = { files: FileDraft[]; active: string }
type EditorPort = { collect: () => string; restore: (raw: string) => void; release: () => void }
const editors = new Map<string, EditorPort>()

export function registerFolderEditorTransfer(id: string, port: EditorPort) {
  editors.set(id, port)
  return () => { if (editors.get(id) === port) editors.delete(id) }
}
export function collectFolderEditorTransfers(ids: string[]) {
  return Object.fromEntries(ids.flatMap(id => {
    const raw = editors.get(id)?.collect() ?? localStorage.getItem(`ails-folder-editor:${id}`)
    return raw ? [[id, raw]] : []
  }))
}
export function releaseFolderEditorTransfers(ids: string[]) {
  for (const id of ids) editors.get(id)?.release()
}
export function folderEditorTransfersUnchanged(snapshots: Record<string, string>) {
  return Object.entries(snapshots).every(([id, raw]) => {
    // Shared storage can be updated by the receiver; a mounted source editor
    // owns the live draft that must not change during the handoff.
    const current = editors.get(id)?.collect()
    return current === undefined || current === raw
  })
}
export function restoreFolderEditorTransfers(snapshots: Record<string, string>) {
  const merged: Record<string, string> = {}
  // Validate every draft before changing any editor. Different unsaved versions
  // of the same file must not silently overwrite each other.
  for (const [id, raw] of Object.entries(snapshots)) {
    const incoming = JSON.parse(raw) as Session
    if (!Array.isArray(incoming.files)) throw new Error("프로젝트 편집 상태가 올바르지 않습니다.")
    const existingRaw = editors.get(id)?.collect()
    const existing = existingRaw ? JSON.parse(existingRaw) as Session : { files: [], active: "" }
    for (const file of incoming.files) {
      const target = existing.files.find(item => item.path === file.path)
      if (target && target.draft !== target.text && file.draft !== file.text && target.draft !== file.draft) {
        throw new Error(`${file.path}: 두 창의 저장하지 않은 변경이 달라 탭을 합치지 않았습니다.`)
      }
    }
    const files = [...existing.files]
    for (const file of incoming.files) {
      const index = files.findIndex(item => item.path === file.path)
      if (index < 0) files.push(file)
      else if (files[index].draft === files[index].text) files[index] = file
    }
    merged[id] = JSON.stringify({ files, active: incoming.active || existing.active })
  }
  for (const [id, raw] of Object.entries(merged)) {
    localStorage.setItem(`ails-folder-editor:${id}`, raw)
    editors.get(id)?.restore(raw)
  }
}
