import { BookOpen, Loader2, Search } from "lucide-react"
import type { PdfOcrStatus, PdfSearchResult } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { snippetSegments } from "../../../lib/search-snippet.ts"
import { PdfOutlineTree } from "./pdf-outline-tree.tsx"
import { usePdfTextToolsDismissal } from "../hooks/use-pdf-text-tools-dismissal.ts"

export type PdfTextToolsModel = {
  /** Whether this is the active viewer surface, independent of OCR metadata. */
  available: boolean
  statusMessage?: string
  close: () => void
  expandedSections: ReadonlySet<string>
  onNavigate: (page: number) => void
  onSearch: () => void | Promise<void>
  onToggleSection: (id: string) => void
  open: boolean
  outline: PdfOcrStatus["outline"]
  query: string
  results: PdfSearchResult[]
  loading?: boolean
  setQuery: (query: string) => void
  toggle: () => void
}

export function PdfTextTools({ textTools }: { textTools: PdfTextToolsModel }) {
  const { panelRef, triggerRef } = usePdfTextToolsDismissal(textTools.open && textTools.available, textTools.close)
  return <>
      {textTools.available && (
        <button
          ref={triggerRef}
          aria-expanded={textTools.open}
          data-ails-pdf-text-tools-trigger="true"
          className="ails-pdf-overlay-surface absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--foreground)] shadow-sm backdrop-blur-sm"
          onClick={(event) => {
            event.stopPropagation()
            textTools.toggle()
          }}
          type="button"
        >
          <Search size={11} /> {t("검색·목차")}
        </button>
      )}

      {textTools.open && textTools.available && (
        <div
          ref={panelRef}
          data-ails-pdf-text-tools-panel="true"
          className="ails-pdf-overlay-surface absolute right-3 top-11 z-40 flex max-h-[70%] w-72 max-w-[calc(100%-1.5rem)] flex-col rounded-xl border border-[var(--border)] p-2 text-[var(--foreground)] shadow-2xl backdrop-blur-xl"
          data-pdf-wheel-scroll-region
          onPointerDown={(event) => event.stopPropagation()}
        >
          {textTools.statusMessage && <div role="status" className="px-2 py-1 text-[10px] text-[var(--muted-foreground)]">{textTools.statusMessage}</div>}
          <form
            className="flex gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              void textTools.onSearch()
            }}
          >
            <input
              autoFocus
              className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px] text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
              id="ails-pdf-search-input"
              onChange={(event) => textTools.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault()
              }}
              placeholder={t("PDF 검색")}
              value={textTools.query}
            />
            <button className="rounded bg-[var(--brand)] px-2 text-[10px] font-bold text-white" type="submit">{t("검색")}</button>
          </form>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain text-[10px]">
            {textTools.loading ? <div role="status" className="flex items-center gap-1.5 px-2 py-3 text-[var(--muted-foreground)]"><Loader2 size={12} className="animate-spin" />{t("검색 중...")}</div> : textTools.results.length > 0 ? textTools.results.map((result, index) => (
              <button
                className="mb-1 block w-full rounded bg-[var(--muted)] p-2 text-left hover:bg-[var(--interactive-hover)]"
                key={`${result.page}-${index}`}
                onClick={() => textTools.onNavigate(result.page)}
                type="button"
              >
                <span className="font-bold text-[var(--brand)]">{result.page}{t("페이지")}</span>
                <span className="mt-0.5 block text-[var(--muted-foreground)]">{snippetSegments(result.snippet).map((segment, segmentIndex) => segment.highlighted
                  ? <mark key={segmentIndex} className="rounded-sm bg-[var(--brand-soft)] px-0.5 font-semibold text-[var(--foreground)]">{segment.text}</mark>
                  : <span key={segmentIndex}>{segment.text}</span>)}</span>
              </button>
            )) : textTools.query.trim() ? <div role="status" className="px-2 py-3 text-[var(--muted-foreground)]">{t("검색 결과가 없습니다.")}</div> : (
              <div className="space-y-1">
                <div className="mb-1 flex items-center gap-1 font-bold text-[var(--foreground)]"><BookOpen size={11} /> {t("목차")}</div>
                <PdfOutlineTree
                  expandedSections={textTools.expandedSections}
                  onSelectPage={textTools.onNavigate}
                  onToggleSection={textTools.onToggleSection}
                  outline={textTools.outline}
                />
              </div>
            )}
          </div>
        </div>
      )}

  </>
}
