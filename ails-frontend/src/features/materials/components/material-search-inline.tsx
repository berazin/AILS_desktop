import { useEffect, useRef } from "react"
import { Search, X } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import type { MaterialSearchModalController } from "../hooks/use-material-search-modal.ts"
import { canSearch, SEARCH_MODE_LABELS } from "../search-modal-state.ts"
import { MaterialSearchResults } from "./material-search-results.tsx"

export function MaterialSearchInline({ controller }: { controller: MaterialSearchModalController }) {
  const rootRef = useRef<HTMLElement | null>(null)
  const { isOpen, presentation, close } = controller
  const showResults = controller.isOpen && controller.presentation === "inline" && canSearch(controller.query, controller.mode)
  const clear = () => { controller.setQuery(""); controller.close() }
  useEffect(() => {
    if (!isOpen || presentation !== "inline") return
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener("mousedown", closeOutside)
    return () => document.removeEventListener("mousedown", closeOutside)
  }, [isOpen, presentation, close])

  return (
    <section ref={rootRef} className="relative ml-auto w-64 max-w-[40vw] shrink-0" aria-label={t("자료 검색")} data-ails-material-search-inline="true"
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === "Escape") controller.setQuery("")
        controller.handleKeyDown(event.nativeEvent)
      }}>
      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 focus-within:border-[var(--brand)]">
        <Search className="shrink-0 text-[var(--muted-foreground)]" size={14} />
        <input className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none" role="searchbox" aria-label={t("자료 검색")}
          onFocus={() => controller.open("inline")}
          onChange={(event) => { controller.open("inline"); controller.setQuery(event.target.value) }}
          placeholder={t("자료 검색")} spellCheck={false} value={controller.query} />
        <button type="button" className="shrink-0 rounded bg-black px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-black/80!"
          aria-label={t("검색 방식 전환")} title={t("Tab으로 키워드 검색과 의미 검색 전환")}
          onClick={() => { controller.open("inline"); controller.toggleMode() }}>
          {t(SEARCH_MODE_LABELS[controller.mode])}
        </button>
        {controller.query ? <button type="button" aria-label={t("검색어 지우기")} className="shrink-0 rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]" onClick={clear}><X size={14} /></button>
          : <kbd className="hidden shrink-0 text-[9px] text-[var(--muted-foreground)] xl:inline">Ctrl K</kbd>}
      </div>
      {showResults && <div className="absolute right-0 top-full z-40 mt-2 flex max-h-[min(46vh,420px)] w-[min(560px,calc(100vw-48px))] min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-lg" data-ails-inline-search-results="true">
        <MaterialSearchResults controller={controller} />
        <div className="shrink-0 border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-[var(--muted-foreground)]">{t("↑ ↓ 이동 · Enter 열기 · Tab 검색 방식 전환 · Esc 지우기")}</div>
      </div>}
    </section>
  )
}
