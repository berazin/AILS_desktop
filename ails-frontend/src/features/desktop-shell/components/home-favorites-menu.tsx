import { useEffect, useRef } from "react"
import { FileText, Folder, Star, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { useHomeMenuFade } from "../hooks/use-home-menu-fade.ts"
import "./home-menu-fade.css"

export type HomeFavoriteItem = { path: string; title: string; kind: string }

export function HomeFavoritesMenu({ items, onOpen, onRemove }: {
  items: HomeFavoriteItem[]
  onOpen: (item: HomeFavoriteItem) => void
  onRemove: (path: string) => void
}) {
  const { open, present, setOpen, onTransitionEnd } = useHomeMenuFade("open")
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", closeOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [open, setOpen])
  return <div className="relative shrink-0" ref={containerRef} data-ails-home-favorites="true">
    <button type="button" className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-white/65 dark:hover:bg-white/[0.06]" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="menu"><Star size={15} />{t("즐겨찾기")}</button>
    {present && <div role="menu" aria-label={t("즐겨찾기")} className="ails-home-menu-fade absolute left-0 top-full z-40 mt-1 max-h-80 w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#181c2b]" data-open={open} aria-hidden={!open} inert={!open} onTransitionEnd={onTransitionEnd}>
      {items.length === 0 && <p className="p-3 text-xs text-slate-500">{t("즐겨찾기가 없습니다.")}</p>}
      {items.map((item) => <div className="flex items-center gap-1" key={item.path}>
        <button type="button" role="menuitem" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-white/[0.06]" title={item.path} onClick={() => { setOpen(false); onOpen(item) }}>
          {item.kind === "folder" ? <Folder size={15} className="shrink-0 text-blue-500" /> : <FileText size={15} className="shrink-0 text-slate-400" />}<span className="truncate">{item.title}</span>
        </button>
        <button type="button" className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]" onClick={() => onRemove(item.path)} aria-label={`${t("즐겨찾기 해제")}: ${item.title}`}><X size={13} /></button>
      </div>)}
    </div>}
  </div>
}
