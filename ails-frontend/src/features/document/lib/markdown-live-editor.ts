import * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { hiddenPreviewLines, markdownPreviewRanges, previewRangeIsSelected, type MarkdownPreviewRange } from "./markdown-live-preview.ts"

export type LivePreviewHost = { range: MarkdownPreviewRange; host: HTMLElement; source:string; definitions: string }
// Monaco 0.55's folding view exposes this method on CodeEditorWidget, but omits it
// from ICodeEditor. Keep the compatibility boundary here and check it at runtime.
type FoldingEditor = Monaco.editor.IStandaloneCodeEditor & {
  setHiddenAreas: (ranges: Monaco.IRange[], source?: unknown) => void
}

const documentModels = new Map<string, {model:Monaco.editor.ITextModel; references:number; selection:Monaco.Selection | null}>()

export function mountMarkdownLiveEditor(container: HTMLElement, content: string, documentId: string,
  onChange: (content: string) => void, onPreviews: (previews: LivePreviewHost[]) => void) {
  let shared = documentModels.get(documentId)
  if (!shared) {
    const uri = Monaco.Uri.from({scheme:"ails-markdown", path:`/${encodeURIComponent(documentId)}`})
    shared = {model:Monaco.editor.createModel(content, "plaintext", uri), references:0, selection:null}
    documentModels.set(documentId, shared)
  }
  shared.references++
  const sharedModel = shared
  const model = shared.model
  function releaseModel() {
    sharedModel.references--
    if (sharedModel.references === 0) {model.dispose(); documentModels.delete(documentId)}
  }
  const editor = Monaco.editor.create(container, {
    model, ariaLabel: "Markdown source", editContext: false, fontFamily: "inherit", fontSize: 14, lineHeight: 24,
    wordWrap: "on", lineNumbers: "off", glyphMargin: false, folding: false,
    lineDecorationsWidth: 0, lineNumbersMinChars: 0, minimap: {enabled:false},
    renderLineHighlight: "none", overviewRulerLanes: 0, hideCursorInOverviewRuler: true,
    scrollBeyondLastLine: false, contextmenu: false, links: false,
    quickSuggestions: false, suggestOnTriggerCharacters: false,
    occurrencesHighlight: "off", selectionHighlight: false, padding: {top:0, bottom:24},
    scrollbar: {vertical:"hidden", horizontal:"hidden", alwaysConsumeMouseWheel:false},
    automaticLayout: false, unicodeHighlight:{ambiguousCharacters:false, invisibleCharacters:false},
  }) as FoldingEditor
  if (typeof editor.setHiddenAreas !== "function") {
    editor.dispose(); releaseModel()
    throw new Error("Installed Monaco does not support Markdown live preview folding")
  }
  let parsed = markdownPreviewRanges(content)
  let syntaxDirty = false
  let publishedPreviews: LivePreviewHost[] = []
  let composing = false
  let changingView = false
  let active = false
  let applyingContent = false
  let disposed = false
  let frame = 0
  let refreshFrame = 0
  const zones = new Map<string, {range:MarkdownPreviewRange; host:HTMLElement; zone:Monaco.editor.IViewZone; id:string; observer:ResizeObserver}>()
  const disposables: Monaco.IDisposable[] = []

  function fit() {
    if (disposed) return
    const width = container.clientWidth
    if (!width) return
    const height = Math.max(80, editor.getContentHeight())
    if (container.style.height !== `${height}px`) container.style.height = `${height}px`
    const layout = editor.getLayoutInfo()
    if (layout.width !== width || layout.height !== height) editor.layout({width, height})
  }
  function scheduleFit() {
    if (frame) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {frame = 0; fit()})
  }
  function refresh() {
    if (disposed || composing || changingView) return
    changingView = true
    const selections = editor.getSelections() ?? []
    const selected = (range:MarkdownPreviewRange) => selections.some(selection =>
      previewRangeIsSelected(range, selection.startLineNumber, selection.endLineNumber))
    const visiblePreviews = parsed.ranges.filter(range => range.imageSource || !selected(range))
    const keys = new Set(visiblePreviews.map(range => range.key))
    const scrollTop = editor.getScrollTop()
    editor.changeViewZones(accessor => {
      for (const [key, entry] of zones) {
        if (!keys.has(key)) {
          accessor.removeZone(entry.id); entry.observer.disconnect(); zones.delete(key)
        }
      }
      for (const range of visiblePreviews) {
        const existing = zones.get(range.key)
        if (existing) {
          existing.range = range
          existing.host.dataset.ailsSourceStart = String(range.start)
          existing.host.dataset.ailsSourceEnd = String(range.end)
          existing.zone.afterLineNumber = selected(range) ? range.endLine : range.startLine - 1
          accessor.layoutZone(existing.id)
          continue
        }
        const host = document.createElement("div")
        host.dataset.ailsLivePreview = range.type
        host.dataset.ailsSourceStart = String(range.start)
        host.dataset.ailsSourceEnd = String(range.end)
        host.style.width = "100%"
        const zone: Monaco.editor.IViewZone = {afterLineNumber:selected(range) ? range.endLine : range.startLine - 1, showInHiddenAreas:true,
          heightInPx:32, domNode:host, suppressMouseDown:false}
        const id = accessor.addZone(zone)
        const observer = new ResizeObserver(() => {
          if (disposed) return
          const height = Math.ceil(host.firstElementChild?.getBoundingClientRect().height ?? 32)
          if (height === zone.heightInPx || height === 0) return
          zone.heightInPx = height
          editor.changeViewZones(change => change.layoutZone(id)); scheduleFit()
        })
        observer.observe(host)
        zones.set(range.key, {range, host, zone, id, observer})
        host.addEventListener("mousedown", event => {
          if (!active || event.button !== 0) return
          event.preventDefault(); event.stopPropagation()
          const entry = zones.get(range.key)
          if (!entry) return
          const target = event.target instanceof HTMLElement ? event.target : null
          const label = target?.textContent?.trim() ?? ""
          const raw = model.getValue().slice(entry.range.start, entry.range.end)
          const offset = label ? raw.indexOf(label) : 0
          revealOffset(entry.range.start + Math.max(0, offset))
        })
        host.addEventListener("click", event => {event.preventDefault(); event.stopPropagation()})
      }
    })
    editor.setHiddenAreas(hiddenPreviewLines(model.getLineCount(), parsed.ranges, selections), container)
    editor.setScrollTop(scrollTop)
    changingView = false
    const previews = Array.from(zones.values(), entry => ({range:entry.range, host:entry.host,
      source:selected(entry.range) ? entry.range.imageSource : entry.range.source, definitions:parsed.definitions}))
    if (previews.length !== publishedPreviews.length || previews.some((preview, index) =>
      preview.host !== publishedPreviews[index].host || preview.source !== publishedPreviews[index].source
      || preview.definitions !== publishedPreviews[index].definitions)) {
      publishedPreviews = previews
      onPreviews(previews)
    }
    scheduleFit()
  }
  function revealOffset(offset: number, extend = false) {
    // Reveal first, then move the native caret; hidden-line validation must not
    // redirect a click to the previous visible source line.
    changingView = true
    editor.setHiddenAreas([], container)
    const position = model.getPositionAt(offset)
    const anchor = editor.getSelection()?.getSelectionStart()
    if (extend && anchor) {
      editor.setSelection(new Monaco.Selection(anchor.lineNumber, anchor.column, position.lineNumber, position.column))
    } else editor.setPosition(position)
    changingView = false
    refresh(); editor.focus()
  }
  function scheduleRefresh() {
    if (disposed || composing || refreshFrame) return
    // Monaco emits model changes before it commits the new caret. Folding in
    // that event would move the caret during paste/IME and split an undo step.
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0
      if (syntaxDirty) {parsed = markdownPreviewRanges(model.getValue()); syntaxDirty = false}
      refresh()
    })
  }
  disposables.push(editor.onDidChangeModelContent(() => {
    syntaxDirty = true
    if (active && !applyingContent) onChange(model.getValue())
    scheduleRefresh()
  }))
  disposables.push(editor.onDidChangeCursorSelection(scheduleRefresh))
  disposables.push(editor.onDidCompositionStart(() => {composing = true}))
  disposables.push(editor.onDidCompositionEnd(() => {
    composing = false; scheduleRefresh()
  }))
  disposables.push(editor.onDidContentSizeChange(scheduleFit))
  disposables.push(editor.onKeyDown(event => {
    if (composing || event.browserEvent.isComposing || event.altKey) return
    if (event.ctrlKey || event.metaKey) {
      if (event.keyCode === Monaco.KeyCode.Home || event.keyCode === Monaco.KeyCode.End) {
        event.preventDefault(); event.stopPropagation()
        revealOffset(event.keyCode === Monaco.KeyCode.Home ? 0 : model.getValueLength(), event.shiftKey)
      } else if (event.keyCode === Monaco.KeyCode.KeyA && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation()
        changingView = true
        editor.setHiddenAreas([], container)
        editor.setSelection(model.getFullModelRange())
        changingView = false
        refresh()
      }
      return
    }
    const position = editor.getPosition()
    if (!position || (!event.shiftKey && !editor.getSelection()?.isEmpty())) return
    const index = parsed.ranges.findIndex(range => range.startLine <= position.lineNumber && range.endLine >= position.lineNumber)
    const range = parsed.ranges[index]
    if (!range) return
    const caretTop = editor.getScrolledVisiblePosition(position)?.top
    const firstTop = editor.getScrolledVisiblePosition({lineNumber:range.startLine, column:1})?.top
    const lastTop = editor.getScrolledVisiblePosition({lineNumber:range.endLine, column:model.getLineMaxColumn(range.endLine)})?.top
    const backwards = (event.keyCode === Monaco.KeyCode.UpArrow && position.lineNumber === range.startLine && caretTop === firstTop)
      || (event.keyCode === Monaco.KeyCode.LeftArrow && position.lineNumber === range.startLine && position.column === 1)
    const forwards = (event.keyCode === Monaco.KeyCode.DownArrow && position.lineNumber === range.endLine && caretTop === lastTop)
      || (event.keyCode === Monaco.KeyCode.RightArrow && position.lineNumber === range.endLine && position.column === model.getLineMaxColumn(position.lineNumber))
    const next = parsed.ranges[index + (backwards ? -1 : 1)]
    if ((!backwards && !forwards) || !next) return
    event.preventDefault(); event.stopPropagation()
    revealOffset(backwards ? next.end : next.start, event.shiftKey)
  }))
  const resize = new ResizeObserver(scheduleFit)
  resize.observe(container)
  // Start on the trailing insertion line, keeping earlier headings/tables/images rendered.
  if (sharedModel.selection) editor.setSelection(sharedModel.selection)
  else editor.setPosition(model.getPositionAt(content.length))
  refresh()
  return {
    textarea: container.querySelector<HTMLTextAreaElement>("textarea"),
    setActive(next: boolean, offset?:number) {
      if (active && !next) sharedModel.selection = editor.getSelection()
      active = next
      if (active) {
        changingView = true
        editor.setHiddenAreas([], container)
        if (offset !== undefined) editor.setPosition(model.getPositionAt(offset))
        else if (sharedModel.selection) editor.setSelection(sharedModel.selection)
        changingView = false
        fit(); refresh(); editor.focus()
      }
    },
    sourceAtViewport(top:number, bottom:number) {
      for (const line of container.querySelectorAll<HTMLElement>(".view-line")) {
        const rect = line.getBoundingClientRect()
        if (rect.height === 0 || rect.bottom <= top || rect.top >= bottom) continue
        const y = Math.max(top,rect.top) + 1
        const target = editor.getTargetAtClientPoint(rect.left + 2,y)
        if (target?.position) return {offset:model.getOffsetAt(target.position), top:rect.top, height:rect.height}
      }
      return null
    },
    sourceRect(offset:number) {
      const position = editor.getScrolledVisiblePosition(model.getPositionAt(offset))
      return position ? {top:container.getBoundingClientRect().top + position.top, height:position.height} : null
    },
    measurePreviews() {
      for (const entry of zones.values()) {
        const child = entry.host.firstElementChild
        if (child) entry.observer.observe(child)
      }
      scheduleFit()
    },
    setContent(next: string) {
      if (model.getValue() === next) return
      editor.pushUndoStop()
      applyingContent = true
      try {
        editor.executeEdits("document-update", [{range:model.getFullModelRange(), text:next, forceMoveMarkers:true}])
      } finally { applyingContent = false }
      editor.pushUndoStop()
    },
    dispose() {
      disposed = true; if (frame) cancelAnimationFrame(frame)
      if (refreshFrame) cancelAnimationFrame(refreshFrame)
      resize.disconnect(); for (const entry of zones.values()) entry.observer.disconnect()
      for (const disposable of disposables) disposable.dispose()
      if (active) sharedModel.selection = editor.getSelection()
      zones.clear(); editor.dispose(); releaseModel()
    },
  }
}
