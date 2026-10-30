import { t } from "../../lib/i18n.ts"
import type { ComponentProps, MouseEvent as ReactMouseEvent } from "react"
import { memo, useCallback, useMemo, useState, useEffect, useRef } from "react"
import { Highlighter } from "lucide-react"
import ReactMarkdown from "react-markdown"
import rehypeKatex from "../markdown/rehype-katex-fallback.ts"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { remarkInlineCodeMath } from "../markdown/remark-inline-code-math.ts"
import { rehypeUnicodeVectorMath, remarkUnicodeVectorMath } from "../markdown/remark-unicode-vector-math.ts"
import { remarkInlineEmphasis } from "../markdown/remark-inline-emphasis.ts"
import { remarkCurrencyText } from "../markdown/remark-currency-text.ts"
import "katex/dist/katex.min.css"
import "../markdown/markdown-inline-code.css"
import { notebookRawHtmlSchema, rehypeHastStyleObject } from "../markdown/raw-html-support.ts"
import { normalizeMarkdownImageSources } from "../markdown/markdown-image-sources.ts"
import { remarkSourceAnchors } from "../markdown/markdown-source-anchors.ts"
import { markdownUrlTransform } from "../markdown/markdown-url-transform.ts"
import { copyTextToClipboard } from "../clipboard/copy-text.ts"

import {
  createMarkdownComponents,
  preprocessLooseLatexBlocks,
  preprocessObsidianCallouts,
  renderCalloutSegments,
} from "../markdown/markdown-rendering.tsx"

interface MarkdownViewerProps {
  content: string
  className?: string
  remarkPlugins?: NonNullable<ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>
  sourceAnchors?: boolean
  urlTransform?: (value: string, key: string) => string
  enableLooseLatexRepair?: boolean
  enableRawHtml?: boolean
  onOpenLocalMarkdown?: (href: string, event?: ReactMouseEvent<HTMLElement>) => void
  onHighlightText?: (text: string) => void
  onAskHighlightedText?: (text: string) => void
  onImageDoubleClick?: (src: string, alt: string) => void
}

export const MarkdownViewer = memo(function MarkdownViewer({
  content,
  className = "",
  remarkPlugins = [],
  sourceAnchors = false,
  urlTransform = markdownUrlTransform,
  enableLooseLatexRepair = false,
  enableRawHtml = false,
  onAskHighlightedText,
  onOpenLocalMarkdown,
  onHighlightText,
  onImageDoubleClick,
}: MarkdownViewerProps) {
  const processedContent = useMemo(() => preprocessObsidianCallouts(normalizeMarkdownImageSources(enableLooseLatexRepair ? preprocessLooseLatexBlocks(content) : content).content), [content, enableLooseLatexRepair])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [selectionCoords, setSelectionCoords] = useState<{ x: number; y: number } | null>(null)
  const [selectedText, setSelectedText] = useState("")
  const [highlightMenu, setHighlightMenu] = useState<{ x: number; y: number; text: string } | null>(null)

  const openHighlightMenu = useCallback((text: string, x: number, y: number) => {
    const trimmed = text.trim()
    if (!trimmed) return false
    setHighlightMenu({
      x,
      y,
      text: trimmed,
    })
    return true
  }, [])

  const handleHighlightContextMenu = useCallback((text: string, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openHighlightMenu(text, event.clientX, event.clientY)
  }, [openHighlightMenu])

  const components = useMemo(
    () => createMarkdownComponents(onOpenLocalMarkdown, handleHighlightContextMenu, onImageDoubleClick),
    [handleHighlightContextMenu, onOpenLocalMarkdown, onImageDoubleClick],
  )

  const updateSelectionFromWindow = useCallback(() => {
    if (!onHighlightText) return
    const root = rootRef.current
    const selection = window.getSelection()
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionCoords(null)
      return
    }

    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
      setSelectionCoords(null)
      return
    }

    const text = selection.toString().trim()
    if (!text) {
      setSelectionCoords(null)
      return
    }

    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    setSelectionCoords({
      x: rect.left + rect.width / 2,
      y: Math.max(8, rect.top - 42),
    })
    setSelectedText(text)
  }, [onHighlightText])

  useEffect(() => {
    const handleSelectionChange = () => {
      window.requestAnimationFrame(updateSelectionFromWindow)
    }
    document.addEventListener("selectionchange", handleSelectionChange)
    return () => document.removeEventListener("selectionchange", handleSelectionChange)
  }, [updateSelectionFromWindow])

  useEffect(() => {
    if (!highlightMenu) return undefined
    const closeMenu = () => setHighlightMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu()
    }
    window.addEventListener("click", closeMenu)
    window.addEventListener("scroll", closeMenu, true)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("click", closeMenu)
      window.removeEventListener("scroll", closeMenu, true)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [highlightMenu])

  const handleSelectionEnd = () => {
    window.requestAnimationFrame(updateSelectionFromWindow)
  }

  const handleMarkdownContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const root = rootRef.current
    const selection = window.getSelection()
    if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return

    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) return

    const text = selection.toString()
    if (!text.trim()) return

    event.preventDefault()
    event.stopPropagation()
    openHighlightMenu(text, event.clientX, event.clientY)
  }

  const handleApplyHighlight = () => {
    if (onHighlightText && selectedText) {
      onHighlightText(selectedText)
      setSelectionCoords(null)
      window.getSelection()?.removeAllRanges()
    }
  }

  const handleCopyHighlightedText = async () => {
    const text = highlightMenu?.text ?? ""
    setHighlightMenu(null)
    if (!text) return
    try {
      await copyTextToClipboard(text)
    } catch {
      // Clipboard access can be denied by the embedded webview; keep the menu action silent.
    }
  }

  const handleAskHighlightedText = () => {
    const text = highlightMenu?.text ?? ""
    setHighlightMenu(null)
    if (text) onAskHighlightedText?.(text)
  }

  const renderMarkdown = (markdown: string, key: string) => {
    return (
      <ReactMarkdown
        components={components}
        key={key}
        rehypePlugins={
          enableRawHtml
            ? [rehypeRaw, [rehypeSanitize, notebookRawHtmlSchema], rehypeHastStyleObject, rehypeUnicodeVectorMath, [rehypeKatex, { strict: "ignore" }]]
            : [rehypeUnicodeVectorMath, [rehypeKatex, { strict: "ignore" }]]
        }
        remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkMath, remarkCurrencyText, remarkInlineEmphasis, remarkInlineCodeMath, remarkUnicodeVectorMath, ...remarkPlugins, ...(sourceAnchors ? [remarkSourceAnchors] : [])]}
        urlTransform={urlTransform}
      >
        {markdown}
      </ReactMarkdown>
    )
  }

  return (
    <div
      onKeyUp={handleSelectionEnd}
      onContextMenu={handleMarkdownContextMenu}
      onMouseUp={handleSelectionEnd}
      onPointerUp={handleSelectionEnd}
      ref={rootRef}
      className={`ails-markdown-viewer relative select-text prose dark:prose-invert max-w-none prose-neutral prose-headings:scroll-m-20 prose-pre:bg-transparent prose-pre:p-0 ${className}`}
    >
      {renderCalloutSegments(processedContent, renderMarkdown)}

      {selectionCoords && (
        <div
          className="fixed z-[9999] -translate-x-1/2 flex items-center gap-1.5 bg-neutral-900 dark:bg-neutral-800 text-white dark:text-neutral-100 px-3 py-2 rounded-lg shadow-lg border border-neutral-700 dark:border-neutral-600 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 duration-150"
          style={{
            left: `${selectionCoords.x}px`,
            top: `${selectionCoords.y}px`,
          }}
        >
          <button
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => event.preventDefault()}
            onClick={handleApplyHighlight}
            className="flex items-center gap-1.5 hover:text-amber-300 transition-colors"
          >
            <Highlighter size={13} className="text-amber-400" />
            <span>Highlight</span>
          </button>
        </div>
      )}

      {highlightMenu && (
        <div
          className="fixed z-[10000] min-w-36 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] py-1 text-sm text-[var(--foreground)] shadow-xl"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          style={{
            left: `${highlightMenu.x}px`,
            top: `${highlightMenu.y}px`,
          }}
        >
          <button
            className="block w-full px-3 py-2 text-left hover:bg-[var(--muted)]"
            onClick={() => void handleCopyHighlightedText()}
            type="button"
          >
            {t("복사")}</button>
          {onAskHighlightedText && (
            <button
              className="block w-full px-3 py-2 text-left hover:bg-[var(--muted)]"
              onClick={handleAskHighlightedText}
              type="button"
            >
              {t("챗봇에 질문")}</button>
          )}
        </div>
      )}
    </div>
  )
})
