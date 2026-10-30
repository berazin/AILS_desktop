import { useEffect, useRef, useState } from "react"
import { requestJson } from "../../../lib/api/core.ts"
import { changeNotebookPackages, notebookEnvironment, type NotebookEnvironmentStatus, type NotebookPackage } from "../../../lib/api/notebook-environments.ts"
import { Button } from "../../../shared/ui/button.tsx"

export function NotebookEnvironmentPanel({ path, running, onRestart }: { path: string; running: boolean; onRestart: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<NotebookEnvironmentStatus>()
  const [packages, setPackages] = useState<NotebookPackage[]>([])
  const [matches, setMatches] = useState<NotebookPackage[]>([])
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [log, setLog] = useState("")
  const [query, setQuery] = useState("")
  const [name, setName] = useState("")
  const [external, setExternal] = useState("")
  const [detected, setDetected] = useState<{ path: string; version: string }[]>([])
  const [restart, setRestart] = useState(false)
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [packagesLoaded, setPackagesLoaded] = useState(false)
  const [packagesError, setPackagesError] = useState("")
  const packageRequest = useRef<AbortController | null>(null)
  const statusRequest = useRef<AbortController | null>(null)
  const mutationPending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      packageRequest.current?.abort()
      if (statusRequest.current && !statusRequest.current.signal.aborted) setError("환경 조회가 중단되었습니다. 새로고침해 주세요.")
      statusRequest.current?.abort()
      // React Activity also disconnects effects while retaining hidden tab state.
      // Do not leave that retained panel stuck in a cancelled read on return.
      setPackagesLoading(false)
      if (!mutationPending.current) setBusy("")
    }
  }, [])
  function cancelReads() {
    packageRequest.current?.abort()
    statusRequest.current?.abort()
    setPackagesLoading(false)
    if (!mutationPending.current) setBusy("")
  }
  function invalidatePackages() {
    packageRequest.current?.abort()
    setPackagesLoading(false); setPackagesLoaded(false); setPackages([]); setPackagesError("")
  }
  async function loadPackages() {
    if (packageRequest.current && !packageRequest.current.signal.aborted) return
    const controller = new AbortController()
    packageRequest.current = controller
    setPackagesLoading(true); setPackagesError("")
    try {
      const installed = await notebookEnvironment<{ packages: NotebookPackage[]; message?: string }>(path, "packages", {}, controller.signal)
      if (controller.signal.aborted || !mounted.current) return
      setPackages(installed.packages); setPackagesLoaded(true); setMessage(installed.message ?? "")
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setPackagesError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (packageRequest.current === controller) packageRequest.current = null
      if (!controller.signal.aborted && mounted.current) setPackagesLoading(false)
    }
  }
  const selected = status?.environments.find(item => item.id === status.selected_id)
  const disabled = Boolean(busy) || running

  async function refresh() {
    if (mutationPending.current) return
    statusRequest.current?.abort()
    invalidatePackages()
    const controller = new AbortController()
    statusRequest.current = controller
    setBusy("환경 확인 중…"); setError(""); setStatus(undefined)
    try {
      const next = await notebookEnvironment<NotebookEnvironmentStatus>(path, "status", {}, controller.signal)
      if (!controller.signal.aborted && mounted.current) setStatus(next)
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (statusRequest.current === controller) statusRequest.current = null
      if (!controller.signal.aborted && mounted.current) setBusy("")
    }
  }
  async function perform(label: string, work: () => Promise<void>) {
    if (mutationPending.current) return
    mutationPending.current = true
    cancelReads()
    setBusy(label); setError(""); setMessage("")
    // Mutations keep their result and lock across Activity hiding; they are not reads.
    try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { mutationPending.current = false; setBusy("") }
  }
  function change(action: string, options: Record<string, string> = {}) {
    void perform("환경 준비 중…", async () => {
      setLog("")
      const next = await notebookEnvironment<NotebookEnvironmentStatus>(path, action, options)
      setStatus(next)
      setRestart(false)
      invalidatePackages()
      setMatches([])
      setMessage("환경을 선택했습니다. 다음 셀 실행에서 새 커널을 시작합니다.")
    })
  }
  function modify(action: "install" | "uninstall", requirement: string) {
    void perform(action === "install" ? "설치 중…" : "삭제 중…", async () => {
      setLog("")
      // A failed/disconnected install can still have changed files; retain the restart prompt.
      setRestart(true)
      const result = await changeNotebookPackages(path, action, [requirement], text => setLog(current => (current + text).slice(-32000)))
      if (result.packages) { setPackages(result.packages); setPackagesLoaded(true) }
      if (!result.ok) throw new Error(result.conflicts || result.log || "패키지 작업이 실패했습니다.")
      setMessage("패키지 변경이 완료되었습니다. 실행 중인 커널을 재시작해 주세요.")
    })
  }
  return <section className="mb-3 rounded-lg border border-[var(--border)] p-2 text-sm" aria-label="Python 환경 관리">
    <Button size="sm" variant="outline" aria-expanded={open} onClick={() => {
      setOpen(!open)
      if (!open && !mutationPending.current) void refresh()
      else if (open) cancelReads()
    }}>Python 환경 · 패키지</Button>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs text-[var(--muted-foreground)]">기본 환경은 여러 노트북에서 공유합니다. 추가 설치는 설치 버튼이나 %pip 셀 실행 시 진행됩니다. 코드와 패키지는 사용자 파일·네트워크에 접근할 수 있습니다.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label>실행 환경 <select aria-label="실행 환경" className="max-w-80 rounded border bg-[var(--panel)] p-1" disabled={disabled || !status} value={status?.selected_id ?? ""} onChange={event => change("select", { environment_id: event.target.value })}>
          {!status && <option value="">{error ? "환경을 불러오지 못했습니다" : "불러오는 중"}</option>}
          {status?.environments.map(item => <option key={item.id} value={item.id}>{item.name}{item.version ? ` · ${item.version}` : ""}</option>)}
        </select></label>
        {!selected?.python && <Button size="sm" disabled={disabled || !status?.bundle_available} onClick={() => change("select", { environment_id: "shared" })}>기본 환경 준비</Button>}
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void refresh()}>새로고침</Button>
      </div>
      {status && !status.bundle_available && <p role="alert">기본 런타임이 포함되지 않은 설치입니다. 기존 환경을 선택하거나 런타임이 포함된 AILS를 사용해 주세요.</p>}
      {selected?.python && <p className="break-all text-xs text-[var(--muted-foreground)]">{selected.python}{!selected.managed && " · 외부 환경은 패키지 조회만 지원"}</p>}
      <div className="flex flex-wrap gap-2">
        <input aria-label="프로젝트 환경 이름" className="rounded border bg-[var(--panel)] p-1" placeholder="프로젝트 환경 이름" value={name} onChange={event => setName(event.target.value)} />
        <Button size="sm" disabled={disabled || !status?.bundle_available} onClick={() => change("create", { name })}>이 폴더의 독립 환경 만들기</Button>
      </div>
      <details><summary className="cursor-pointer">외부 Python / Conda 연결</summary><div className="mt-2 flex flex-wrap gap-2">
        <input aria-label="외부 Python 경로" className="min-w-72 flex-1 rounded border bg-[var(--panel)] p-1" placeholder="ipykernel이 설치된 python.exe 경로" value={external} onChange={event => setExternal(event.target.value)} />
        <Button size="sm" disabled={disabled || !external.trim()} onClick={() => change("register", { python: external })}>연결</Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => void perform("Python 감지 중…", async () => setDetected((await requestJson<{ installations: { path: string; version: string }[] }>("/python/status")).installations))}>설치된 Python 찾기</Button>
        {detected.map(item => <button className="w-full break-all text-left text-xs underline" key={item.path} onClick={() => setExternal(item.path)}>{item.version} · {item.path}</button>)}
      </div></details>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void perform("PyPI 검색 중…", async () => {
        const found = await notebookEnvironment<{ packages: NotebookPackage[]; message?: string }>(path, "search", { query })
        setMatches(found.packages); setMessage(found.message ?? "")
      }) }}>
        <input aria-label="패키지 이름 또는 버전" className="min-w-64 flex-1 rounded border bg-[var(--panel)] p-1" value={query} onChange={event => setQuery(event.target.value)} placeholder="seaborn 또는 seaborn==0.13.2" />
        <Button type="submit" size="sm" variant="outline" disabled={disabled || !query.trim()}>이름으로 검색</Button>
        <Button type="button" size="sm" disabled={disabled || !query.trim() || !selected?.managed} onClick={() => modify("install", query)}>설치</Button>
      </form>
      {matches.map(item => <div key={item.name} className="rounded bg-[var(--muted)] p-2"><strong>{item.name} {item.version}</strong><p>{item.summary}</p><p className="text-xs">Python {item.requires_python || "제한 없음"}</p><Button size="sm" disabled={disabled || !selected?.managed} onClick={() => modify("install", `${item.name}==${item.version}`)}>이 버전 설치</Button></div>)}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={disabled || !status || packagesLoading} onClick={() => void loadPackages()}>{packagesLoaded ? "패키지 목록 새로고침" : "설치된 패키지 보기"}</Button>
        {packagesLoading && <><span role="status">패키지 목록 확인 중…</span><Button size="sm" variant="outline" onClick={() => { packageRequest.current?.abort(); setPackagesLoading(false) }}>조회 취소</Button></>}
      </div>
      {packagesError && <p role="alert">패키지 목록을 불러오지 못했습니다: {packagesError}</p>}
      {packagesLoaded && <div className="max-h-60 overflow-auto"><table className="w-full text-left text-xs"><caption className="text-left">설치된 패키지 {packages.length}개</caption><thead><tr><th>패키지</th><th>버전</th><th><span className="sr-only">작업</span></th></tr></thead><tbody>{packages.map(item => <tr key={item.name}><td>{item.name}</td><td>{item.version}</td><td><button className="p-1 underline disabled:opacity-40" disabled={disabled || !selected?.managed || ["ipykernel", "ipython", "pip", "uv"].includes(item.name.toLowerCase())} onClick={() => modify("uninstall", item.name)} aria-label={`${item.name} 삭제`}>삭제</button></td></tr>)}</tbody></table></div>}
      {busy && <p role="status">{busy}</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="whitespace-pre-wrap break-words text-red-600">{error}</p>}
      {restart && <Button size="sm" disabled={disabled} onClick={() => void perform("커널 재시작 중…", async () => { if (await onRestart()) setRestart(false) })}>패키지 적용을 위해 커널 재시작</Button>}
      {log && <pre aria-label="패키지 작업 로그" className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2 text-xs">{log}</pre>}
    </div>}
  </section>
}
