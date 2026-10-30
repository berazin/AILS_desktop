import { useMemo, useRef } from "react"
import { FileText, Folder, FolderTree, Star, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { workspacePinKey } from "../hooks/use-workspace-pins.ts"
import { useProcessbarScrollProximity } from "../hooks/use-processbar-scroll-proximity.ts"
import type { HomeFavoriteItem } from "./home-favorites-menu.tsx"

export function HomeFavoritesNavigation({ items, rootPath, folderPath, onNavigate, onOpen, onRemove, isOpening }: {
  items: readonly HomeFavoriteItem[]
  rootPath: string
  folderPath: string
  onNavigate: (path: string) => void
  onOpen: (path: string) => void
  onRemove: (path: string) => void
  isOpening: (path: string) => boolean
}) {
  const scroll = useRef<HTMLDivElement>(null)
  useProcessbarScrollProximity(scroll)
  const entries = useMemo(() => {
    const seen = new Set<string>()
    return items.filter((item) => {
      const key = workspacePinKey(item.path)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder")
      || a.title.localeCompare(b.title, "ko", { numeric: true, sensitivity: "base" }))
  }, [items])
  const rootSelected = !folderPath || workspacePinKey(folderPath) === workspacePinKey(rootPath)
  const buttonClass = "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-[var(--interactive-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--brand)]"
  return <aside className="flex w-48 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--background)] px-2 py-3 text-[var(--foreground)]" aria-label={t("즐겨찾기 탐색")} data-ails-home-favorites-navigation="true">
    <button type="button" className={`${buttonClass} shrink-0 flex-none ${rootSelected ? "bg-[var(--brand-soft)] text-[var(--brand)]" : ""}`}
      title={rootPath} aria-current={rootSelected ? "location" : undefined} onClick={() => onNavigate("")}><FolderTree size={16} className="shrink-0" />{t("작업공간")}</button>
    <div className="mb-1 mt-5 flex items-center gap-2 px-2 py-1 text-[11px] font-semibold text-[var(--muted-foreground)]"><Star size={13} />{t("즐겨찾기")}</div>
    <nav ref={scroll} className="ails-processbar-scroll min-h-0 flex-1 overflow-y-auto" aria-label={t("즐겨찾기 항목")}>
      {entries.length === 0 && <p className="px-2 py-3 text-xs leading-5 text-[var(--muted-foreground)]">{t("파일이나 폴더를 즐겨찾기에 추가하면 여기에 표시됩니다.")}</p>}
      {entries.map((item) => {
        const folder = item.kind === "folder"
        const active = folder && workspacePinKey(folderPath) === workspacePinKey(item.path)
        return <div key={workspacePinKey(item.path)} className={`group flex min-w-0 items-center rounded-md ${active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : ""}`}>
          <button type="button" className={buttonClass} title={item.path} aria-current={active ? "location" : undefined}
            data-ails-favorite-path={item.path} disabled={!folder && isOpening(item.path)}
            onClick={() => folder ? onNavigate(item.path) : onOpen(item.path)}>
            {folder ? <Folder size={16} className="shrink-0 text-blue-500" /> : <FileText size={15} className="shrink-0 text-[var(--muted-foreground)]" />}
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
          </button>
          <button type="button" className="mr-1 shrink-0 rounded p-1 text-[var(--muted-foreground)] opacity-0 hover:bg-[var(--interactive-hover)] focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={`${t("즐겨찾기 해제")}: ${item.title}`} onClick={() => onRemove(item.path)}><X size={12} /></button>
        </div>
      })}
    </nav>
  </aside>
}
