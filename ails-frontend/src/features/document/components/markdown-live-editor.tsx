import { useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { mountMarkdownLiveEditor, type LivePreviewHost } from "../lib/markdown-live-editor.ts"
import type { ViewerMarkdownEditorModel } from "../hooks/use-viewer-editing-workflow.ts"
import type { MarkdownContentAnchor, MarkdownLiveController } from "../lib/markdown-content-anchor.ts"
import "./markdown-live-editor.css"

export function MarkdownLiveEditor({ active, editor, documentId, urlTransform, controllerRef, anchorRef }: {
  active:boolean; documentId:string; editor:ViewerMarkdownEditorModel; urlTransform:(value:string, key:string)=>string
  controllerRef:RefObject<MarkdownLiveController | null>; anchorRef:RefObject<MarkdownContentAnchor | null>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<ReturnType<typeof mountMarkdownLiveEditor> | null>(null)
  const [previews, setPreviews] = useState<LivePreviewHost[]>([])
  const {textareaRef} = editor
  const onChange = useEventCallback((value:string) => editor.onChange(value))
  const currentContent = useEventCallback(() => editor.content)
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !active || instanceRef.current) return
    const instance = mountMarkdownLiveEditor(container, currentContent(), documentId, onChange, setPreviews)
    instanceRef.current = instance
    controllerRef.current = instance
  }, [active, currentContent, documentId, onChange, controllerRef])
  // Retain the editor across edit/read changes, but a suspended tab releases it.
  // Returning to a reader must not rebuild Monaco before the page can paint.
  useLayoutEffect(() => () => {
    const instance = instanceRef.current
    if (!instance) return
    if (textareaRef.current === instance.textarea) textareaRef.current = null
    instanceRef.current = null; controllerRef.current = null; instance.dispose()
    setPreviews([])
  }, [documentId, textareaRef, controllerRef])
  useLayoutEffect(() => {instanceRef.current?.setContent(editor.content)}, [editor.content])
  useLayoutEffect(() => {
    const instance = instanceRef.current
    if (!instance) return
    instance.setActive(active, active ? anchorRef.current?.offset : undefined)
    if (active) textareaRef.current = instance.textarea
    else if (textareaRef.current === instance.textarea) textareaRef.current = null
  }, [active, textareaRef, anchorRef])
  useLayoutEffect(() => {instanceRef.current?.measurePreviews()}, [previews])
  return <div hidden={!active} data-ails-live-editor className="ails-markdown-live-editor" onClick={event => event.stopPropagation()} onKeyDownCapture={event => {
    if (event.key === "Tab" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")) editor.onKeyDown(event)
  }} onKeyDown={event => event.stopPropagation()}>
    <div ref={containerRef} />
    {previews.map(({range, host, source, definitions}) => createPortal(
      <div className="ails-markdown-live-preview"><MarkdownViewer content={`${source}\n\n${definitions}`}
        sourceAnchors urlTransform={urlTransform} /></div>, host, range.key))}
  </div>
}
