import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import type { ViewerMarkdownEditorModel } from "../hooks/use-viewer-editing-workflow.ts"
import { MarkdownLiveEditor } from "./lazy-markdown-live-editor.tsx"
import { draftPreviewUrlTransform } from "../lib/draft-preview-url-transform.ts"
import { markdownPreviewRanges } from "../lib/markdown-live-preview.ts"
import { annotateMarkdownContent, captureMarkdownContent, restoreMarkdownContent, type MarkdownContentAnchor, type MarkdownLiveController } from "../lib/markdown-content-anchor.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { MarkdownImageVisibility } from "../../../shared/markdown/markdown-image-visibility.ts"
import { observeDocumentPresentation } from '../../../lib/document-presentation-diagnostics.ts'

type MarkdownActions = {
  onAskHighlightedText: (text: string) => void
  onHighlightText: (text: string) => void
  onImageDoubleClick: (src: string, alt: string) => void
  onOpenLocal: (href: string, event?: MouseEvent<HTMLElement>) => void
}

/** Keep the reader mounted, and edit its single text model with cursor-local source syntax. */
export function MarkdownDocumentSurface({ document, active, interactive = true, editor, markdown, scrollRef }: {
  document: ViewerDocument; active: boolean; interactive?:boolean; editor: ViewerMarkdownEditorModel; markdown: MarkdownActions
  scrollRef?:RefObject<HTMLElement | null>
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<MarkdownLiveController | null>(null)
  const anchorRef = useRef<MarkdownContentAnchor | null>(null)
  const {beforeModeChangeRef} = editor
  const onAskHighlightedText = useEventCallback(markdown.onAskHighlightedText)
  const onHighlightText = useEventCallback(markdown.onHighlightText)
  const onImageDoubleClick = useEventCallback(markdown.onImageDoubleClick)
  const onOpenLocal = useEventCallback(markdown.onOpenLocal)
  const projection = !active ? editor.imagePreview : undefined
  const source = projection?.content ?? (editor.content === (document.raw_content ?? document.content) ? document.content : editor.content)
  const hiddenImages = useMemo(() => new Set(projection?.hiddenImages), [projection?.hiddenImages])
  const [preview, setPreview] = useState(source)
  useLayoutEffect(() => {
    if (!active) return observeDocumentPresentation('md', () => rootRef.current?.querySelector('.ails-markdown-viewer'))
  }, [active, document.id])
  // Typing leaves the rendered document alone; update changed content when reading resumes.
  useLayoutEffect(() => {
    if (!active && source !== preview) setPreview(source)
  }, [active, source, preview])
  const urlTransform = useCallback((value: string, key: string) =>
    draftPreviewUrlTransform(value, key, document.file_path), [document.file_path])
  const anchorContent = projection?.rawContent ?? editor.content
  const anchors = useMemo(() => markdownPreviewRanges(anchorContent).anchors, [anchorContent])
  const getScrollContainer = useEventCallback(() => {
    if (scrollRef?.current) return scrollRef.current
    for (let parent = rootRef.current?.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
    }
    return window.document.scrollingElement as HTMLElement | null
  })
  const currentRoot = useEventCallback(() => rootRef.current?.querySelector<HTMLElement>(active ? "[data-ails-live-editor]" : "[data-ails-md-reader]") ?? null)
  const annotate = useEventCallback((root:HTMLElement) => annotateMarkdownContent(root,anchors,src=>urlTransform(src,"src")))
  const capture = useEventCallback((next?: boolean) => {
    const root = currentRoot(), scroller = getScrollContainer()
    if (!root || !scroller) return
    if (next && !active && projection) {
      // The reused reader still has the original DOM; entering the editor
      // needs offsets in the current source, with removed image links omitted.
      annotateMarkdownContent(root, markdownPreviewRanges(editor.content).anchors, src => urlTransform(src, "src"))
    } else annotate(root)
    anchorRef.current = captureMarkdownContent(root,scroller,active ? controllerRef.current : null)
  })
  const restore = useEventCallback(() => {
    const root = currentRoot(), scroller = getScrollContainer(), anchor = anchorRef.current
    if (!interactive || !root || !scroller || !anchor) return
    annotate(root)
    restoreMarkdownContent(root,scroller,active ? controllerRef.current : null,anchor)
  })
  useLayoutEffect(() => {
    if (!interactive) {anchorRef.current = null; return}
    beforeModeChangeRef.current = capture
    return () => {if (beforeModeChangeRef.current === capture) beforeModeChangeRef.current = null}
  }, [capture, beforeModeChangeRef, interactive])
  useLayoutEffect(() => {
    const root = rootRef.current, scroller = getScrollContainer()
    if (!root || !scroller || !interactive) return
    let frame = 0
    const schedule = () => {if (!frame && anchorRef.current) frame = requestAnimationFrame(() => {frame=0; restore()})}
    const stop = () => {anchorRef.current = null}
    const resize = new ResizeObserver(schedule)
    const mutations = new MutationObserver(schedule)
    resize.observe(root)
    mutations.observe(root,{subtree:true,childList:true})
    root.addEventListener("load",schedule,true)
    scroller.addEventListener("wheel",stop,{passive:true})
    scroller.addEventListener("pointerdown",stop)
    scroller.addEventListener("keydown",stop,true)
    restore(); schedule()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect(); mutations.disconnect()
      root.removeEventListener("load",schedule,true)
      scroller.removeEventListener("wheel",stop); scroller.removeEventListener("pointerdown",stop); scroller.removeEventListener("keydown",stop,true)
    }
  }, [active, preview, getScrollContainer, interactive, restore])
  return <div ref={rootRef} data-ails-md-surface="true" style={{overflowAnchor:"none"}}>
    <div data-ails-md-reader hidden={active}>
      <MarkdownImageVisibility value={hiddenImages}>
        <MarkdownViewer content={preview} sourceAnchors urlTransform={urlTransform}
          onAskHighlightedText={onAskHighlightedText} onHighlightText={onHighlightText}
          onImageDoubleClick={onImageDoubleClick} onOpenLocalMarkdown={onOpenLocal} />
      </MarkdownImageVisibility>
    </div>
    <MarkdownLiveEditor active={active && interactive} documentId={document.id} editor={editor} urlTransform={urlTransform}
      controllerRef={controllerRef} anchorRef={anchorRef} />
  </div>
}
