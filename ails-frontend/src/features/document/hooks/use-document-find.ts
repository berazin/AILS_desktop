import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

import { viewerDocumentIsPdf, type ViewerDocument } from "../../../lib/viewer-document.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { findDocumentRanges, revealDocumentRange } from "../lib/document-find.ts"
import { textSearchPattern } from "../../../shared/lib/text-search.ts"
import type { SearchScrollMarksHandle } from "../../../shared/components/search-scroll-marks.tsx"

export function useDocumentFind(options: {
  active: boolean
  document: ViewerDocument | null
  editing: boolean
  fullscreen: boolean
  primaryRef: RefObject<HTMLElement | null>
  fullscreenRef: RefObject<HTMLElement | null>
}) {
  const { active, document: currentDocument, editing, fullscreen, primaryRef, fullscreenRef } = options
  const enabled = active && Boolean(currentDocument) && !viewerDocumentIsPdf(currentDocument) && !editing
  const documentKey = enabled ? `${currentDocument?.id}:${currentDocument?.file_path}` : ""
  const [open, setOpen] = useState(false), [query, setQuery] = useState("")
  const [count, setCount] = useState(0), [index, setIndex] = useState(0)
  const [searchOptions, setSearchOptions] = useState({ wholeWord: false, regex: false })
  const error = textSearchPattern(query, searchOptions).error
  const scrollMarksRef = useRef<SearchScrollMarksHandle>(null)
  const rangesRef = useRef<Range[]>([]), clearHighlightsRef = useRef<(() => void) | null>(null)
  const [position, setPosition] = useState({ top: 48, right: 8, width: 380 })
  const inputRef = useRef<HTMLInputElement>(null), returnFocus = useRef<HTMLElement | null>(null)
  const container = useEventCallback(() => fullscreen ? fullscreenRef.current : primaryRef.current)
  const root = useEventCallback(() => container()?.querySelector<HTMLElement>("[data-ails-document-search-root]") ?? container())
  const getTargets = useEventCallback(() => rangesRef.current)
  const clearHighlights = useEventCallback(() => { clearHighlightsRef.current?.(); clearHighlightsRef.current = null })
  const paint = useEventCallback((activeIndex: number, reveal = true) => {
    clearHighlights()
    const target = root(), scroller = container()
    if (!target || !open || !enabled) return
    // A React commit can replace a syntax layer's text nodes. Keep ranges outside
    // render state and refresh invalidated ranges after that commit.
    if (rangesRef.current.some(range => range.collapsed || !target.contains(range.startContainer))) rangesRef.current = findDocumentRanges(target, query, searchOptions)
    const ranges = rangesRef.current, currentRange = ranges[activeIndex]
    if (CSS.highlights) {
      const all = new Highlight(), current = new Highlight(...(currentRange ? [currentRange] : []))
      for (const range of ranges) all.add(range)
      CSS.highlights.set("ails-document-find", all)
      CSS.highlights.set("ails-document-find-current", current)
      clearHighlightsRef.current = () => {
        if (CSS.highlights.get("ails-document-find") === all) CSS.highlights.delete("ails-document-find")
        if (CSS.highlights.get("ails-document-find-current") === current) CSS.highlights.delete("ails-document-find-current")
      }
    }
    if (reveal && scroller && currentRange) revealDocumentRange(currentRange, scroller)
    scrollMarksRef.current?.refresh()
  })
  const show = useEventCallback(() => {
    if (!enabled) return
    const target = root()
    if (!target) return
    // Reflow documents already provide search and result navigation.
    const existing = target.querySelector<HTMLInputElement>("[data-ails-document-search-input]")
    if (existing) { existing.focus({ preventScroll: true }); existing.select(); return }
    if (!open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const selection = document.getSelection()
      if (selection?.anchorNode && target.contains(selection.anchorNode) && target.contains(selection.focusNode)) {
        const text = selection.toString()
        if (text.trim() && text.length <= 200) setQuery(text)
      }
    }
    setOpen(true)
    inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select()
  })
  const close = useEventCallback(() => {
    setOpen(false)
    const previous = returnFocus.current
    const target = previous?.isConnected && previous.getClientRects().length ? previous : root()
    target?.focus({ preventScroll: true })
  })
  const move = useEventCallback((direction: -1 | 1) => {
    if (count) setIndex(current => (current + direction + count) % count)
  })

  useEffect(() => { setOpen(false); setQuery(""); setCount(0); rangesRef.current = []; setIndex(0) }, [documentKey])
  useLayoutEffect(() => {
    if (open && enabled) { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select() }
  }, [open, enabled, fullscreen])
  useEffect(() => {
    if (!open || !enabled) return
    const target = root(), scroller = container()
    if (!target || !scroller) return
    let timer = 0
    const search = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        rangesRef.current = findDocumentRanges(target, query, searchOptions)
        setCount(rangesRef.current.length); setIndex(0); paint(0)
      }, 80)
    }
    const positionBar = () => {
      const rect = scroller.getBoundingClientRect()
      const gutter = Math.max(0, scroller.offsetWidth - scroller.clientWidth)
      setPosition({ top: Math.max(40, rect.top + 8), right: Math.max(8, window.innerWidth - rect.right + gutter + 8), width: Math.max(0, Math.min(380, rect.width - gutter - 16)) })
    }
    const mutations = new MutationObserver(search), resize = new ResizeObserver(positionBar)
    mutations.observe(target, { childList: true, characterData: true, subtree: true })
    resize.observe(scroller)
    window.addEventListener("resize", positionBar)
    positionBar(); search()
    return () => { clearTimeout(timer); mutations.disconnect(); resize.disconnect(); window.removeEventListener("resize", positionBar) }
  }, [open, enabled, query, searchOptions, fullscreen, documentKey, currentDocument?.loading, root, container, paint])
  useLayoutEffect(() => {
    if (open && enabled) paint(index)
    else clearHighlights()
    return clearHighlights
  }, [open, enabled, count, index, fullscreen, paint, clearHighlights])
  useEffect(() => {
    if (!open || !enabled) return
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return
      if (Array.from(document.querySelectorAll<HTMLElement>("[aria-modal='true'],[data-ails-window='true'],[data-ails-code-sandbox='true']"))
        .some(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden")) return
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); close()
      } else if (event.key === "F3" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g")) {
        event.preventDefault(); event.stopImmediatePropagation(); move(event.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
  }, [open, enabled, close, move])
  return { open: open && enabled, show, close, query, setQuery, index, count, move, inputRef, position,
    searchOptions, setSearchOptions, error, scrollMarksRef, getContainer: container, getTargets, markerKey: `${documentKey}:${fullscreen}` }
}

export type DocumentFindController = ReturnType<typeof useDocumentFind>
