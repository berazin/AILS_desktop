import { useEffect, useId, useRef } from "react"
import { X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { HomeRecentFilesList, type HomeRecentFilesListProps } from "./home-recent-files.tsx"

export function HomeRecentFilesDialog({ onClose, onOpen, onSelect, ...listProps }: HomeRecentFilesListProps & { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const headingId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" data-ails-home-recent-dialog="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={headingId} className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xl dark:border-white/10 dark:bg-[#131622] dark:text-white" onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === "Escape") { event.preventDefault(); onClose() }
      if (event.key === "Tab") {
        const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-white/[0.08]">
        <h2 id={headingId} className="text-sm font-bold">{t("최근 파일")}</h2>
        <button type="button" aria-label={t("최근 파일 목록 닫기")} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" onClick={onClose}><X size={16} /></button>
      </header>
      <HomeRecentFilesList {...listProps} onOpen={(path) => { onClose(); onOpen(path) }} onSelect={(item) => { onClose(); onSelect(item) }} />
    </div>
  </div>
}
