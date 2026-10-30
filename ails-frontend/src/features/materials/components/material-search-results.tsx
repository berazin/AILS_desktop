import { useEffect, useRef } from "react"
import { FileText, Loader2 } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { MaterialSearchModalController } from "../hooks/use-material-search-modal.ts"
import { canSearch, SEARCH_MODE_LABELS, orderedSections, snippetSegments, type SearchModalResult } from "../search-modal-state.ts"

function ResultRow({
  active,
  index,
  item,
  onHover,
  onOpen,
}: {
  active: boolean
  index: number
  item: SearchModalResult
  onHover: (index: number) => void
  onOpen: (item: SearchModalResult) => void
}) {
  const segments = snippetSegments(item.snippet)
  return (
    <button
      className={`flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors ${active
        ? "border-[var(--border)] bg-[var(--interactive-hover)]"
        : "border-transparent hover:bg-[var(--muted)]"}`}
      data-search-active={active ? "true" : undefined}
      onClick={() => onOpen(item)}
      onMouseEnter={() => onHover(index)}
      type="button"
    >
      <span className="flex w-full items-center gap-2">
        <FileText className="shrink-0 text-[var(--muted-foreground)]" size={13} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{item.title}</span>
        <span className="shrink-0 rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
          {item.match_source === "title" ? t("제목") : t("p.{p0}", { p0: item.page })}
        </span>
        <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
          {item.mode === "keyword" ? t("키워드") : t("의미")}
        </span>
      </span>
      <span className="line-clamp-2 break-all text-xs text-[var(--muted-foreground)]">
        {item.section ? <span className="font-medium text-[var(--foreground)]">{item.section} · </span> : null}
        {segments.map((segment, segmentIndex) => segment.highlighted
          ? (
              <mark className="rounded-sm bg-[var(--brand-soft)] px-0.5 font-semibold text-[var(--foreground)]" key={segmentIndex}>
                {segment.text}
              </mark>
            )
          : <span key={segmentIndex}>{segment.text}</span>)}
      </span>
    </button>
  )
}

export function MaterialSearchResults({ controller }: { controller: MaterialSearchModalController }) {
  const { activeIndex, flattened, isOpen, keywordResults, keywordNotice, mode, openResult, query,
    semanticNotice, semanticResults, semanticStatus, setActiveIndexTo, searching, searchNotice } = controller
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    listRef.current?.querySelector('[data-search-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, isOpen, query, mode])

  const validQuery = canSearch(query, mode)
  const sections = orderedSections(mode, { keyword: keywordResults, semantic: semanticResults }).map(
    (section, sectionIndex, all) => ({
      ...section,
      startIndex: all.slice(0, sectionIndex).reduce((sum, part) => sum + part.items.length, 0),
    }),
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" ref={listRef}>
      {searching && semanticStatus !== "preparing" && <div role="status" className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--muted-foreground)]"><Loader2 className="animate-spin" size={12} />{t("검색 중...")}</div>}
      {searchNotice && <p role="alert" className="px-3 py-2 text-xs text-[var(--muted-foreground)]">{t("검색에 실패했습니다.")} {searchNotice}</p>}
      {!validQuery
        ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
              {t("선택한 방식으로 검색합니다. Tab으로 키워드 검색과 의미 검색을 전환하세요.")}
              {mode === "keyword" ? <span className="mt-2 block">{t("제목과 본문에서 찾습니다. *는 길이 제한 없이 중간 문자열을 대신합니다.")}</span> : null}
            </p>
          )
        : null}
      {sections.map((section) => {
        const isActiveMode = section.mode === mode
        const semanticPreparing = section.mode === "semantic" && semanticStatus === "preparing"
        const semanticUnavailable = section.mode === "semantic" && semanticStatus === "unavailable"
        return (
          <section className="mb-1" key={section.mode}>
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className={`text-[11px] font-semibold ${isActiveMode ? "text-[var(--brand)]" : "text-[var(--muted-foreground)]"}`}>
                {t(SEARCH_MODE_LABELS[section.mode])}
                {isActiveMode
                  ? (
                      <span className="ml-1.5 rounded bg-[var(--brand)] px-1 py-0.5 text-[9px] font-bold text-white">
                        {t("현재")}
                      </span>
                    )
                  : null}
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)]">
                {section.items.length > 0 ? t("{p0}건", { p0: section.items.length }) : ""}
              </span>
            </div>
            {section.mode === "keyword" && keywordNotice
              ? <div role="status" className="px-3 py-2 text-xs text-[var(--muted-foreground)]">{keywordNotice}</div> : null}
            {semanticPreparing
              ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    <Loader2 className="animate-spin" size={12} />
                    {t("의미 검색 준비 중...")}
                  </div>
                )
              : null}
            {semanticUnavailable
              ? (
                  <div className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
                    {semanticNotice || t("의미 검색을 사용할 수 없습니다.")}
                  </div>
                )
              : null}
            {section.items.map((item, itemIndex) => {
              const index = section.startIndex + itemIndex
              return (
                <ResultRow
                  active={index === activeIndex}
                  index={index}
                  item={item}
                  key={`${item.path}:${item.page}:${index}`}
                  onHover={setActiveIndexTo}
                  onOpen={openResult}
                />
              )
            })}
          </section>
        )
      })}
      {validQuery && !searching && !searchNotice && flattened.length === 0 && (mode === "keyword" ? !keywordNotice : (semanticStatus !== "preparing" && semanticStatus !== "unavailable"))
        ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">
              {t("검색 결과가 없습니다.")}
            </p>
          )
        : null}
    </div>
  )
}
