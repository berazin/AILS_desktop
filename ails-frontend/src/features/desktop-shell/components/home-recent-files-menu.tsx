import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent } from "react"
import { ChevronDown, ChevronRight, FileText, History, Pin } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { MaterialItem } from "../hooks/use-materials-listing.ts"
import { useHomeMenuFade } from "../hooks/use-home-menu-fade.ts"
import "./home-menu-fade.css"

export function HomeRecentFilesMenu({ items, onShowAll, onOpen, onMenu, isOpening }: {
  items: MaterialItem[]
  onShowAll: () => void
  onOpen: (path: string) => void
  onMenu: (event: MouseEvent, item: MaterialItem) => void
  isOpening: (path: string) => boolean
}) {
  const { mode, setMode, open, present, onTransitionEnd } = useHomeMenuFade<"hover" | "pinned">("pinned")
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingFocus = useRef<"first" | "last" | null>(null)
  const menuId = useId()

  function cancelHover() {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
  }
  function close() {
    cancelHover()
    pendingFocus.current = null
    setMode("closed")
  }
  function focusFile(edge: "first" | "last") {
    const files = menuRef.current?.querySelectorAll<HTMLButtonElement>("[data-ails-recent-file]:not(:disabled)")
    const target = edge === "last" ? files?.[files.length - 1] : files?.[0]
    const focusTarget = target ?? menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")
    focusTarget?.focus()
  }
  useEffect(() => () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current)
  }, [])
  useEffect(() => {
    if (!open) return
    if (pendingFocus.current) {
      focusFile(pendingFocus.current)
      pendingFocus.current = null
    }
    const closeOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setMode("closed")
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMode("closed")
        triggerRef.current?.focus()
      }
    }
    document.addEventListener("mousedown", closeOutside)
    document.addEventListener("focusin", closeOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeOutside)
      document.removeEventListener("focusin", closeOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [open, mode, setMode])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault()
      event.stopPropagation()
      close()
      triggerRef.current?.focus()
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || (open && (event.key === "Home" || event.key === "End"))) {
      event.preventDefault()
      event.stopPropagation()
      cancelHover()
      const edge = event.key === "ArrowUp" || event.key === "End" ? "last" : "first"
      if (!open) {
        pendingFocus.current = edge
        setMode("pinned")
      } else if (event.target === triggerRef.current || event.key === "Home" || event.key === "End") {
        focusFile(edge)
      } else {
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus()
      }
    }
  }

  return <div className="relative shrink-0" ref={rootRef} data-ails-home-recent-menu="true" onKeyDown={handleKeyDown}
    onMouseEnter={() => {
      if (open) return
      cancelHover()
      if (mode === "closing") { setMode("hover"); return }
      hoverTimer.current = setTimeout(() => { hoverTimer.current = null; setMode("hover") }, 180)
    }}
    onMouseLeave={() => {
      cancelHover()
      if (mode === "hover" && !menuRef.current?.contains(document.activeElement)) setMode("closed")
    }}>
    <button ref={triggerRef} type="button" className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${open ? "bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white" : "text-slate-600 hover:bg-slate-100 dark:text-white/65 dark:hover:bg-white/[0.06]"}`} aria-label={t("최근 파일")} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
      onClick={(event) => {
        cancelHover()
        if (mode === "pinned") close()
        else {
          if (event.detail === 0) pendingFocus.current = "first"
          setMode("pinned")
        }
      }}><History size={15} />{t("최근")}<ChevronDown size={12} /></button>
    {present && <div className="ails-home-menu-fade absolute left-0 top-full z-50 w-[360px] max-w-[calc(100vw-48px)] pt-1" data-open={open} aria-hidden={!open} inert={!open} onTransitionEnd={onTransitionEnd}>
      <div ref={menuRef} id={menuId} role="menu" aria-label={t("최근 파일")} className="max-h-[calc(100vh-140px)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg ails-processbar-scroll dark:border-white/10 dark:bg-[#181c2b]">
        <div className="mb-1 flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-xs font-bold">{t("최근 파일")}</span>
          <button type="button" role="menuitem" className="flex items-center gap-1 rounded px-1 py-1 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-white/10" onClick={() => { close(); onShowAll() }}>{t("전체 보기")}<ChevronRight size={12} /></button>
        </div>
        {items.length === 0 ? <p className="px-2 py-5 text-center text-xs text-slate-400">{t("최근에 연 파일이 없습니다.")}</p> : items.slice(0, 7).map((item) => <button key={item.path} type="button" role="menuitem" data-ails-recent-file="true" className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs text-slate-600 hover:bg-slate-100 hover:text-blue-600 focus:bg-slate-100 disabled:opacity-50 dark:text-white/70 dark:hover:bg-white/[0.06] dark:focus:bg-white/[0.06]" disabled={isOpening(item.path)} title={item.title} onClick={() => { close(); onOpen(item.path) }} onContextMenu={(event) => onMenu(event, item)}>
          <FileText size={14} className="shrink-0 text-slate-400" /><span className="min-w-0 flex-1 truncate">{item.title}</span>{item.isPinned && <Pin size={10} className="shrink-0 text-blue-500" />}<span className="shrink-0 whitespace-nowrap text-[10px] text-slate-400 dark:text-white/40">{item.date}</span>
        </button>)}
      </div>
    </div>}
  </div>
}
