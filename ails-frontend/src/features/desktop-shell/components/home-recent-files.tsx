import type { MouseEvent } from "react"
import { Clock, Info, MoreHorizontal, Pin } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { MaterialItem } from "../hooks/use-materials-listing.ts"
import { StudyCardCover } from "./study-card-cover.tsx"

export type HomeRecentFilesListProps = {
  items: MaterialItem[]
  onOpen: (path: string) => void
  onSelect: (item: MaterialItem) => void
  onMenu: (event: MouseEvent, item: MaterialItem) => void
  isOpening: (path: string) => boolean
}

export function HomeRecentFilesList({ items, onOpen, onSelect, onMenu, isOpening }: HomeRecentFilesListProps) {
  return <div className="min-h-0 flex-1 overflow-y-auto ails-processbar-scroll" data-ails-home-recent-scroll="true">
      {items.length === 0 ? <p className="px-5 py-10 text-center text-xs text-slate-400 dark:text-white/40">{t("최근에 연 파일이 없습니다.")}</p> : items.map((item) => <div key={item.path} className="group flex items-center gap-1 border-b border-slate-100 px-3 last:border-b-0 hover:bg-slate-50/80 dark:border-white/[0.04] dark:hover:bg-white/[0.02]" onContextMenu={(event) => onMenu(event, item)}>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left disabled:opacity-60" disabled={isOpening(item.path)} onClick={() => onOpen(item.path)}>
          <StudyCardCover card={item} lastPage={item.lastPage || 1} compact className="h-14 w-[43px] rounded-md shadow-sm" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-xs font-semibold text-slate-800 group-hover:text-blue-600 dark:text-white/90 dark:group-hover:text-blue-400" title={item.title}>{item.title}</span>{item.isPinned && <Pin size={11} className="shrink-0 text-blue-500" />}</span>
            <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-white/40"><span>{item.kind === "MD" ? t("정리본") : item.kind}</span>{item.readRange && <><span>·</span><span>{item.readRange}</span></>}</span>
            <span className="mt-1 flex items-center gap-1 text-[10px] text-slate-400 dark:text-white/40"><Clock size={10} />{item.date}</span>
          </span>
        </button>
        <button type="button" className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-white/10" aria-label={`${item.title} ${t("정보 보기")}`} onClick={() => onSelect(item)}><Info size={14} /></button>
        <button type="button" className="shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label={`${item.title} ${t("더보기")}`} onClick={(event) => onMenu(event, item)}><MoreHorizontal size={15} /></button>
      </div>)}
  </div>
}
