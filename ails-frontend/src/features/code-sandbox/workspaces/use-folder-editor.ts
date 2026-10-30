import { useCallback, useEffect, useRef, useState } from "react"
import { workspaceRequest, type WorkspaceEntry, type WorkspaceFile } from "./api.ts"
import { registerFolderEditorTransfer } from "./folder-editor-transfer.ts"

export type EditorFile = WorkspaceFile & { draft: string; viewState?: unknown; reloadCount?: number }
type EditorSession = { files: EditorFile[]; active: string }

function loadSession(id: string): EditorSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(`ails-folder-editor:${id}`) || "null")
    if (parsed && Array.isArray(parsed.files)) return {
      files: parsed.files.filter((file: EditorFile) => typeof file.path === "string" && typeof file.draft === "string"
        && typeof file.text === "string" && typeof file.revision === "string"),
      active: typeof parsed.active === "string" ? parsed.active : "",
    }
  } catch { /* Keep disk files available if cached drafts are corrupt. */ }
  return null
}

export function useFolderEditor(id: string, initialFile?: WorkspaceFile) {
  const [session, setSession] = useState(() => loadSession(id) ?? (initialFile
    ? { files: [{ ...initialFile, draft: initialFile.text }], active: initialFile.path }
    : { files: [], active: "" }))
  const [tree, setTree] = useState<Record<string, WorkspaceEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]))
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const latest = useRef(session)
  const mounted = useRef(true)
  const writing = useRef(false)
  const transferred = useRef(false)
  const requests = useRef(new Set<AbortController>())
  const sequence = useRef(0)
  const changeSession = useCallback((update: (current: EditorSession) => EditorSession) => {
    setSession((current) => {
      const next = update(current)
      latest.current = next
      return next
    })
  }, [])
  const persist = useCallback(() => {
    if (transferred.current) return
    try { localStorage.setItem(`ails-folder-editor:${id}`, JSON.stringify(latest.current)) }
    catch { setError("편집 초안을 보관할 공간이 부족합니다. 파일을 저장하세요.") }
  }, [id])

  useEffect(() => registerFolderEditorTransfer(id, {
    collect: () => {
      if (writing.current) throw new Error("프로젝트 파일 저장이 끝난 뒤 탭을 이동해 주세요.")
      return JSON.stringify(latest.current)
    },
    restore: raw => changeSession(() => JSON.parse(raw) as EditorSession),
    release: () => { transferred.current = true },
  }), [id, changeSession])

  useEffect(() => {
    const timer = window.setTimeout(persist, 200)
    return () => window.clearTimeout(timer)
  }, [session, persist])
  useEffect(() => {
    mounted.current = true
    const pending = requests.current
    const flush = () => persist()
    window.addEventListener("pagehide", flush)
    window.addEventListener("beforeunload", flush)
    return () => {
      persist()
      mounted.current = false
      pending.forEach((controller) => controller.abort())
      window.removeEventListener("pagehide", flush)
      window.removeEventListener("beforeunload", flush)
    }
  }, [persist])

  const request = useCallback(async <T,>(operation: string, payload: Record<string, unknown>) => {
    const controller = new AbortController()
    requests.current.add(controller)
    try { return await workspaceRequest<T>(operation, { id, ...payload }, controller.signal) }
    finally { requests.current.delete(controller) }
  }, [id])
  const refresh = useCallback(async (path = "") => {
    try {
      const result = await request<{ entries: WorkspaceEntry[] }>("tree", { path })
      if (mounted.current) setTree((current) => ({ ...current, [path]: result.entries }))
    } catch (reason) { if (mounted.current && !(reason instanceof Error && reason.name === "AbortError")) setError(String(reason)) }
  }, [request])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    let cancelled = false
    async function reconcile() {
      for (const cached of latest.current.files) {
        try {
          const disk = await request<WorkspaceFile>("read", { path: cached.path })
          if (cancelled) return
          if (disk.revision !== cached.revision) {
            if (cached.draft !== cached.text) setError(`${cached.path}: 파일이 외부에서 변경되었습니다. 저장 전 변경 내용을 확인하세요.`)
            else changeSession((current) => ({ ...current, files: current.files.map((file) =>
              file.path === cached.path && file.draft === cached.draft && file.revision === cached.revision
                ? { ...disk, draft: disk.text, viewState: file.viewState, reloadCount: (file.reloadCount ?? 0) + 1 } : file) }))
          }
        } catch (reason) { if (!cancelled) setError(String(reason)) }
      }
    }
    void reconcile()
    return () => { cancelled = true }
  }, [request, changeSession])

  const open = useCallback(async (path: string, reload = false) => {
    const token = ++sequence.current
    const cached = latest.current.files.find((file) => file.path === path)
    if (cached && !reload) {
      changeSession((current) => ({ ...current, active: path }))
      return
    }
    if (reload && cached && cached.draft !== cached.text && !confirm("저장하지 않은 변경을 버리고 다시 불러올까요?")) return
    try {
      const result = await request<WorkspaceFile>("read", { path })
      if (!mounted.current) return
      changeSession((current) => ({
        active: sequence.current === token ? path : current.active,
        files: current.files.some((file) => file.path === path)
          ? current.files.map((file) => file.path === path ? { ...result, draft: result.text, reloadCount: (file.reloadCount ?? 0) + 1 } : file)
          : [...current.files, { ...result, draft: result.text }],
      }))
      setError("")
    } catch (reason) { if (mounted.current) setError(String(reason)) }
  }, [changeSession, request])

  useEffect(() => {
    if (initialFile) void open(initialFile.path)
  }, [initialFile, open])

  async function save(all = false) {
    if (writing.current) return false
    writing.current = true
    setBusy(true)
    const submitted = latest.current.files.filter((file) => (all || file.path === latest.current.active) && file.draft !== file.text)
    try {
      if (all) for (const file of latest.current.files.filter((item) => item.draft === item.text)) {
        const disk = await request<WorkspaceFile>("read", { path: file.path })
        if (disk.revision !== file.revision) throw new Error(`${file.path}: 파일이 외부에서 변경되었습니다. 다시 불러온 후 실행하세요.`)
      }
      for (const file of submitted) {
        const saved = await request<WorkspaceFile>("save", { path: file.path, text: file.draft, revision: file.revision })
        if (!mounted.current) return false
        changeSession((current) => ({ ...current, files: current.files.map((item) =>
          item.path === file.path ? { ...item, text: saved.text, revision: saved.revision } : item) }))
      }
      setError("")
      setStatus(submitted.length ? `${submitted.length}개 파일 저장됨` : "모든 변경 사항 저장됨")
      return true
    } catch (reason) { if (mounted.current) setError(String(reason)); return false }
    finally { writing.current = false; if (mounted.current) setBusy(false) }
  }

  async function mutate(operation: "create" | "rename" | "delete", path: string, destination = "", directory = false, text = "") {
    if (writing.current) return
    writing.current = true
    setBusy(true)
    try {
      const opened = latest.current.files.filter((file) => file.path === path || file.path.startsWith(`${path}/`))
      if (operation === "delete" && !confirm(`${path}을 삭제할까요?${opened.some((file) => file.draft !== file.text) ? " 저장하지 않은 변경도 삭제됩니다." : ""}`)) return
      const disk = operation === "delete" && !directory ? await request<WorkspaceFile>("read", { path }) : null
      await request(operation, { path, destination, directory, text, revision: disk?.revision ?? opened[0]?.revision })
      if (!mounted.current) return
      if (operation !== "create") changeSession((current) => {
        const matches = (name: string) => name === path || name.startsWith(`${path}/`)
        const renamed = (name: string) => matches(name) ? destination + name.slice(path.length) : name
        const files = operation === "delete" ? current.files.filter((file) => !matches(file.path))
          : current.files.map((file) => ({ ...file, path: renamed(file.path) }))
        return { files, active: operation === "rename" ? renamed(current.active)
          : matches(current.active) ? files[0]?.path ?? "" : current.active }
      })
      const nextExpanded = new Set([""])
      for (const folder of expanded) {
        const affected = folder === path || folder.startsWith(`${path}/`)
        if (operation === "delete" && affected) continue
        nextExpanded.add(operation === "rename" && affected ? destination + folder.slice(path.length) : folder)
      }
      const target = operation === "rename" ? destination : path
      const parents = target.split("/").slice(0, -1)
      for (let count = 1; count <= parents.length; count++) nextExpanded.add(parents.slice(0, count).join("/"))
      setTree({})
      setExpanded(nextExpanded)
      await Promise.all([...nextExpanded].map((folder) => refresh(folder)))
      if (operation === "create" && !directory) await open(path)
      setError("")
      return true
    } catch (reason) { if (mounted.current) setError(String(reason)); return false }
    finally { writing.current = false; if (mounted.current) setBusy(false) }
  }

  function replaceDraft(path: string, draft: string) {
    changeSession((current) => ({ ...current, files: current.files.map((file) => file.path === path
      ? { ...file, draft, reloadCount: (file.reloadCount ?? 0) + 1 } : file) }))
  }
  function getFile(path: string) { return latest.current.files.find((file) => file.path === path) }
  function close(path: string) {
    const file = latest.current.files.find((item) => item.path === path)
    if (file && file.draft !== file.text && !confirm("저장하지 않은 변경을 버리고 파일 탭을 닫을까요?")) return
    changeSession((current) => {
      const files = current.files.filter((item) => item.path !== path)
      return { files, active: current.active === path ? files.at(-1)?.path ?? "" : current.active }
    })
  }
  function update(path: string, draft: string, viewState?: unknown, reloadCount?: number) {
    if (latest.current.files.find((file) => file.path === path)?.draft !== draft) setStatus("")
    changeSession((current) => ({ ...current, files: current.files.map((file) => file.path === path
      && (reloadCount === undefined || (file.reloadCount ?? 0) === reloadCount)
      ? { ...file, draft, ...(viewState === undefined ? {} : { viewState }) } : file) }))
  }
  async function toggleFolder(path: string) {
    setExpanded((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })
    if (!tree[path]) await refresh(path)
  }
  return { ...session, tree, expanded, busy, error, setError, status, setStatus, open, close, update, replaceDraft, getFile, save, mutate, refresh, toggleFolder }
}
