import { useEffect, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import { ChevronRight, FileText, Folder, Plus } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { CreatedWorkspaceEntry, WorkspaceEntryKind } from "../../materials/hooks/use-workspace-entry-creation.ts"

type Props = {
  children: ReactNode
  parentPath: string
  onCreate?: (parentPath: string, kind: WorkspaceEntryKind) => Promise<CreatedWorkspaceEntry>
  onCreated: (entry: CreatedWorkspaceEntry, parentPath: string) => void
  onOpen: () => void
}

export function WorkspaceBackgroundMenu({ children, parentPath, onCreate, onCreated, onOpen }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; parent: string } | null>(null)
  const [submenu, setSubmenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const menuRef = useRef<HTMLDivElement>(null)
  const creatingRef = useRef(false)

  useEffect(() => {
    if (!menu) return
    const dismiss = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null) }
    const close = () => setMenu(null)
    document.addEventListener("mousedown", dismiss)
    window.addEventListener("blur", close)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("mousedown", dismiss)
      window.removeEventListener("blur", close)
      window.removeEventListener("resize", close)
    }
  }, [menu])

  function open(event: ReactMouseEvent) {
    if ((event.target as Element).closest("[data-ails-workspace-item], button, input, textarea, select, th, [role='menu'], [role='dialog'], aside")) return
    event.preventDefault()
    event.stopPropagation()
    if (!onCreate || !parentPath || creatingRef.current) return
    onOpen()
    setError("")
    setSubmenu(false)
    setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 200)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 120)), parent: parentPath })
  }

  async function create(kind: WorkspaceEntryKind) {
    if (!menu || !onCreate || creatingRef.current) return
    creatingRef.current = true
    setBusy(true)
    setMenu(null)
    try { onCreated(await onCreate(menu.parent, kind), menu.parent) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { creatingRef.current = false; setBusy(false) }
  }

  const itemClass = "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-blue-50 focus:bg-blue-50 focus:outline-none dark:hover:bg-white/10 dark:focus:bg-white/10"
  const panelClass = "w-48 rounded-md border border-slate-200 bg-white py-1 text-slate-800 shadow-lg dark:border-white/10 dark:bg-[#181c2b] dark:text-white"
  return <div className="relative flex min-h-0 min-w-0 flex-1 flex-col cursor-default select-none" data-ails-workspace-background="true" onContextMenu={open}>
    {children}
    {busy && <p className="shrink-0 px-6 py-1 text-xs text-slate-500" role="status">{t("자료 생성 중…")}</p>}
    {error && <p className="shrink-0 px-6 py-1 text-xs text-red-600" role="alert">{error}</p>}
    {menu && createPortal(<div ref={menuRef} className={`fixed z-[100] ${panelClass}`} role="menu" aria-label={t("작업공간 메뉴")}
      style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Escape") { event.preventDefault(); setMenu(null) }
        else if (event.key === "ArrowRight") { event.preventDefault(); setSubmenu(true) }
      }}>
      <button type="button" role="menuitem" className={itemClass} autoFocus aria-haspopup="menu" aria-expanded={submenu}
        onMouseEnter={() => setSubmenu(true)} onClick={() => setSubmenu(true)}>
        <Plus size={14} />{t("새로 만들기")}<ChevronRight size={14} className="ml-auto" />
      </button>
      {submenu && <div className={`absolute top-0 ${menu.x + 392 > window.innerWidth ? "right-full mr-1" : "left-full ml-1"} ${panelClass}`} role="menu" aria-label={t("새로 만들기")}
        onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setSubmenu(false) } }}>
        {([['folder', t('폴더')], ['md', t('마크다운')], ['txt', t('텍스트 파일')]] as const).map(([kind, label]) => <button type="button" role="menuitem" className={itemClass} key={kind} onClick={() => void create(kind)}>
          {kind === "folder" ? <Folder size={14} /> : <FileText size={14} />}{label}
        </button>)}
      </div>}
    </div>, document.body)}
  </div>
}
