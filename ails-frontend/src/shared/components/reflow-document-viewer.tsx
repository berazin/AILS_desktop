import { t } from "../../lib/i18n.ts"
import { observeDocumentPresentation } from '../../lib/document-presentation-diagnostics.ts'
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Pause, Play, Search } from "lucide-react"

import type { AilsDocumentModel, DocumentBlock, DocumentSourceLocation, DocumentTocEntry } from "../../lib/api"
import { textSearchMatches, textSearchPattern } from "../lib/text-search.ts"
import { TextSearchOptions } from "./text-search-options.tsx"
import { SearchScrollMarks } from "./search-scroll-marks.tsx"
import { useEventCallback } from "../hooks/use-event-callback.ts"


function blockText(block: DocumentBlock) {
  if (block.type === "table") return block.text || block.rows.flat().join(" ")
  if (block.type === "image") return block.alt || block.source_ref || t("이미지")
  return block.text
}

function locationProps(location: DocumentSourceLocation) {
  return location.kind === "reflow"
    ? {
        "data-source-section": location.section_index,
        "data-source-element": location.element,
        "data-source-offset": location.offset,
        "data-source-native-offset": location.native_offset,
      }
    : { "data-source-page": location.page }
}

function flattenToc(items: DocumentTocEntry[]): DocumentTocEntry[] {
  return items.flatMap((item) => [item, ...flattenToc(item.children)])
}

export function ReflowDocumentViewer({ document: model }: { document: AilsDocumentModel }) {
  const id = useId().replace(/:/g, "")
  const [query, setQuery] = useState("")
  const [activeMatch, setActiveMatch] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [searchOptions, setSearchOptions] = useState({ wholeWord: false, regex: false })
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => observeDocumentPresentation(model.metadata.format.toLowerCase(), () => rootRef.current?.querySelector('article')), [model])
  const search = useMemo(() => textSearchPattern(query, searchOptions), [query, searchOptions])
  const blocks = useMemo(
    () => model.sections.flatMap((section, sectionIndex) =>
      section.blocks.map((block, blockIndex) => ({ block, sectionIndex, blockIndex }))),
    [model],
  )
  const matches = useMemo(
    () => blocks.filter(({ block }) => textSearchMatches(blockText(block), search.pattern, searchOptions.wholeWord).length > 0),
    [blocks, search, searchOptions.wholeWord],
  )
  const getSearchContainer = useEventCallback(() => {
    for (let parent = rootRef.current?.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) return parent
    }
    return null
  })
  const getSearchTargets = useEventCallback(() => matches.flatMap(match => {
    const element = documentViewElement(id, match.sectionIndex, match.blockIndex)
    return element ? [element] : []
  }))

  useEffect(() => setActiveMatch(0), [query, searchOptions])
  useEffect(() => {
    const match = matches[activeMatch]
    if (!match) return
    documentViewElement(id, match.sectionIndex, match.blockIndex)?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [activeMatch, id, matches])
  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  function toggleSpeech() {
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const chunks = blocks.flatMap(({ block }) => {
      const text = blockText(block).trim()
      return text ? Array.from({ length: Math.ceil(text.length / 2500) }, (_, index) => text.slice(index * 2500, (index + 1) * 2500)) : []
    })
    if (!chunks.length || !("speechSynthesis" in window)) return
    window.speechSynthesis.cancel()
    chunks.forEach((text, index) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = document.documentElement.lang || navigator.language
      if (index === chunks.length - 1) {
        utterance.onend = () => setSpeaking(false)
        utterance.onerror = () => setSpeaking(false)
      }
      window.speechSynthesis.speak(utterance)
    })
    setSpeaking(true)
  }

  const toc = flattenToc(model.toc)
  return (
    <div ref={rootRef} className="grid min-h-[480px] gap-5 xl:grid-cols-[220px_minmax(0,1fr)]" data-ails-document-model="1">
      <SearchScrollMarks enabled={matches.length > 0} getContainer={getSearchContainer} getTargets={getSearchTargets} activeIndex={activeMatch}
        revision={`${query}:${searchOptions.wholeWord}:${searchOptions.regex}:${matches.length}`} />
      <aside className="self-start rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 xl:sticky xl:top-2">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{t("목차")}</div>
        <nav className="max-h-56 space-y-1 overflow-auto xl:max-h-[55vh]" aria-label={t("문서 목차")}>
          {toc.length ? toc.map((item, index) => {
            const sectionIndex = item.location.kind === "reflow" ? item.location.section_index : 0
            return (
              <button
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--interactive-hover)]"
                key={`${item.title}-${index}`}
                onClick={() => document.getElementById(`${id}-section-${sectionIndex}`)?.scrollIntoView({ behavior: "smooth" })}
                type="button"
              >
                {item.title}
              </button>
            )
          }) : <div className="text-xs text-[var(--muted-foreground)]">{t("목차 없음")}</div>}
        </nav>
      </aside>

      <div className="min-w-0">
        <div className="sticky top-0 z-10 mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)]/95 p-2 shadow-sm backdrop-blur">
          <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2">
            <Search size={14} />
            <input
              data-ails-document-search-input="true"
              aria-label={t("문서 검색")}
              aria-invalid={Boolean(search.error)}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() }
                if (event.key === "Enter") {
                  event.preventDefault(); event.stopPropagation()
                  if (matches.length) setActiveMatch(current => (current + (event.shiftKey ? -1 : 1) + matches.length) % matches.length)
                }
              }}
              placeholder={t("문서 검색")}
              value={query}
            />
          </label>
          <TextSearchOptions value={searchOptions} onChange={setSearchOptions} />
          <span className="min-w-14 text-center text-xs text-[var(--muted-foreground)]">
            {matches.length ? `${activeMatch + 1}/${matches.length}` : t("0건")}
          </span>
          <button aria-label={t("이전 검색 결과")} className="rounded p-1.5 hover:bg-[var(--interactive-hover)]" disabled={!matches.length} onClick={() => setActiveMatch((activeMatch - 1 + matches.length) % matches.length)} type="button"><ChevronLeft size={16} /></button>
          <button aria-label={t("다음 검색 결과")} className="rounded p-1.5 hover:bg-[var(--interactive-hover)]" disabled={!matches.length} onClick={() => setActiveMatch((activeMatch + 1) % matches.length)} type="button"><ChevronRight size={16} /></button>
          <button className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs hover:bg-[var(--interactive-hover)]" onClick={toggleSpeech} type="button">
            {speaking ? <Pause size={14} /> : <Play size={14} />}
            {speaking ? t("읽기 중지") : t("문서 읽기")}
          </button>
          {search.error && <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">{t(search.error)}</p>}
        </div>

        <article className="mx-auto max-w-4xl select-text space-y-8">
          <header>
            <h1 className="text-3xl font-bold">{model.metadata.title || t("제목 없음")}</h1>
            {model.metadata.creators.length > 0 && <p className="mt-2 text-sm text-[var(--muted-foreground)]">{model.metadata.creators.join(", ")}</p>}
          </header>
          {model.sections.map((section, sectionIndex) => (
            <section className="scroll-mt-16 space-y-4" id={`${id}-section-${sectionIndex}`} key={section.id || sectionIndex} {...locationProps(section.location)}>
              {section.blocks.map((block, blockIndex) => {
                const active = matches[activeMatch]?.sectionIndex === sectionIndex && matches[activeMatch]?.blockIndex === blockIndex
                const key = `${section.id}-${blockIndex}`
                const props = {
                  className: `scroll-mt-20 rounded px-1 ${active ? "bg-[var(--brand-soft)] ring-1 ring-[var(--brand)]" : ""}`,
                  id: `${id}-block-${sectionIndex}-${blockIndex}`,
                  ...locationProps(block.location),
                }
                if (block.type === "heading") return <div key={key} role="heading" aria-level={Math.min(6, Math.max(1, block.level))} {...props} className={`${props.className} text-xl font-semibold`}>{block.text}</div>
                if (block.type === "paragraph") return <p key={key} {...props} className={`${props.className} whitespace-pre-wrap leading-7`}>{block.text}</p>
                if (block.type === "image") return <figure key={key} {...props} className={`${props.className} border-l-2 border-[var(--border)] py-2 pl-3 text-sm text-[var(--muted-foreground)]`}><figcaption>{t("이미지: ")}{block.alt || block.source_ref || t("설명 없음")}</figcaption></figure>
                return (
                  <div key={key} {...props} className={`${props.className} overflow-x-auto`}>
                    <table className="w-full border-collapse text-sm">
                      <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td className="border border-[var(--border)] p-2" key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )
              })}
            </section>
          ))}
        </article>
      </div>
    </div>
  )
}

function documentViewElement(id: string, sectionIndex: number, blockIndex: number) {
  return document.getElementById(`${id}-block-${sectionIndex}-${blockIndex}`)
}
