import { ChevronDown, ChevronUp, Search, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { DocumentFindController } from "../hooks/use-document-find.ts"
import "./document-find-bar.css"
import { TextSearchOptions } from "../../../shared/components/text-search-options.tsx"
import { SearchScrollMarks } from "../../../shared/components/search-scroll-marks.tsx"

export function DocumentFindBar({ controller }: { controller: DocumentFindController }) {
  const { open, position, inputRef, query, setQuery, count, index, move, close, searchOptions, setSearchOptions, error,
    scrollMarksRef, getContainer, getTargets, markerKey } = controller
  if (!open) return null
  return <><div role="search" aria-label={t("문서 검색")} data-ails-document-find
    className="fixed z-[100] flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-2 text-[var(--foreground)] shadow-lg"
    style={position}>
    <div className="flex w-full min-w-0 items-center gap-1">
    <Search size={15} className="shrink-0 text-[var(--muted-foreground)]" />
    <input ref={inputRef} aria-label={t("문서 검색")} placeholder={t("문서 검색")} value={query} aria-invalid={Boolean(error)}
      className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm outline-none" autoComplete="off" spellCheck={false}
      onChange={event => setQuery(event.currentTarget.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); move(event.shiftKey ? -1 : 1) }
      }} />
    <button type="button" aria-label={t("검색 닫기")} title="Esc" onClick={close} className="rounded p-1 hover:bg-[var(--muted)]"><X size={16} /></button>
    </div>
    <div className="flex w-full items-center gap-1">
    <TextSearchOptions value={searchOptions} onChange={setSearchOptions} />
    <span aria-live="polite" role="status" className="ml-auto shrink-0 whitespace-nowrap px-1 text-xs text-[var(--muted-foreground)]">
      {query ? `${count ? index + 1 : 0}/${count}` : "0/0"}
    </span>
    <button type="button" aria-label={t("이전 검색 결과")} title="Shift+Enter" disabled={!count} onClick={() => move(-1)} className="rounded p-1 hover:bg-[var(--muted)] disabled:opacity-40"><ChevronUp size={16} /></button>
    <button type="button" aria-label={t("다음 검색 결과")} title="Enter" disabled={!count} onClick={() => move(1)} className="rounded p-1 hover:bg-[var(--muted)] disabled:opacity-40"><ChevronDown size={16} /></button>
    </div>
    {error && <p role="alert" className="w-full px-1 text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
  </div>
  <SearchScrollMarks ref={scrollMarksRef} enabled={open && count > 0 && !error} getContainer={getContainer} getTargets={getTargets} activeIndex={index} revision={markerKey} />
  </>
}
