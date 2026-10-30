import { questionTextBounds } from "./quick-chat-edit-context-bounds.ts"
import type { QuestionCharacterBoundsEvent, QuestionCompositionLayout, QuestionContextConstructor,
  QuestionEditContext, QuestionReader, QuestionTextFormatEvent } from "./quick-chat-edit-context-types.ts"

type Options = {
  enabled: boolean
  input: HTMLTextAreaElement | null
  draft: string
  open: boolean
  change: (value: string) => void
  show: () => void
  hide: () => void
  layout: (value: QuestionCompositionLayout) => void
  resize?: () => void
}
type Binding = { host: QuestionReader; context: QuestionEditContext | null; dispose: () => void }
const SURFACES = "[data-ails-quick-chat-focus-surface='true']"
const TEXT_CONTROLS = "input,textarea,select,[contenteditable='true'],[role='textbox'],[role='menu'],[role='listbox'],[role='combobox'],[data-chat-composer-popup],.monaco-editor,[data-ails-workspace-inline-rename],[data-ails-workspace-rename-session='true']"
const CONTROLS = `${TEXT_CONTROLS},button,a,[role='button'],[data-ails-workspace-item],[data-pdf-annotation-control]`

export function createQuickChatEditContext(options: () => Options) {
  const Constructor = (window as Window & { EditContext?: QuestionContextConstructor }).EditContext
  const bindings = new Map<QuestionReader, Binding>()
  let active: Binding | null = null, lastHost: QuestionReader | null = null
  let composing = false, compositionStart = 0, frame = 0, transitionUntil = 0, pointerDown = false, closeAfterComposition = false
  let focusFrame = 0
  let formats: { rangeStart: number; rangeEnd: number }[] = []
  const selected = () => {
    const selection = document.getSelection()
    // Selection.toString() can force layout even for an empty caret. Keep the
    // text check for real ranges (an image-only range is not selected text).
    return Boolean(selection && !selection.isCollapsed && selection.toString())
  }
  const modal = () => Array.from(document.querySelectorAll<HTMLElement>(
    "[aria-modal='true'],[data-ails-window='true'],[data-ails-chatbot-window='true'],[data-ails-code-sandbox='true'],[data-ails-document-menu-open='true']",
  )).some(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden")
  const ready = () => options().enabled && !modal() && document.visibilityState !== "hidden"
  const visible = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== "hidden" && !element.closest("[inert],[aria-hidden='true']")
  const clearComposition = () => {
    composing = false; formats = []; closeAfterComposition = false
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    active?.host.removeAttribute("data-ails-question-entry")
    options().layout(null)
  }
  const sync = (binding: Binding) => {
    const context = binding.context
    if (!context || composing) return
    const value = options().input?.value ?? options().draft
    if (context.text !== value) context.updateText(0, context.text.length, value)
    if (context.selectionStart !== value.length || context.selectionEnd !== value.length) context.updateSelection(value.length, value.length)
  }
  const mirror = () => {
    const input = options().input, context = active?.context
    if (!input || !context) return
    input.value = context.text
    options().change(context.text)
    options().show()
    options().resize?.()
  }
  const measure = (request?: QuestionCharacterBoundsEvent) => {
    const input = options().input, context = active?.context
    if (!input || !context || !composing) return
    const caret = questionTextBounds(input, context.text, context.selectionEnd, context.selectionEnd)
    context.updateControlBounds(input.getBoundingClientRect())
    context.updateSelectionBounds(caret.caret)
    if (request) context.updateCharacterBounds(request.rangeStart,
      questionTextBounds(input, context.text, request.rangeStart, request.rangeEnd).characters)
    const spans = formats.length ? formats : [{ rangeStart: compositionStart, rangeEnd: context.selectionEnd }]
    const underlines = spans.flatMap(span => questionTextBounds(input, context.text, span.rangeStart, span.rangeEnd).characters.map(caret.local))
    options().layout({ caret: caret.local(caret.caret), underlines })
  }
  const trackEntrance = () => {
    if (!composing) return
    measure()
    if (performance.now() < transitionUntil) frame = requestAnimationFrame(trackEntrance)
    else frame = 0
  }
  const transfer = () => {
    const current = active, input = options().input
    if (!current?.context || !input || !ready() || document.activeElement !== current.host) return
    const { selectionStart, selectionEnd, text } = current.context
    clearComposition()
    if (!text.length) { options().hide(); return }
    options().show()
    input.value = text
    input.focus({ preventScroll: true })
    input.setSelectionRange(selectionStart, selectionEnd)
  }
  const attach = (binding: Binding) => {
    const next = selected() ? null : binding.context
    if (binding.host.editContext !== next) binding.host.editContext = next
  }
  const bind = (host: QuestionReader) => {
    if (bindings.has(host) || host.editContext) return
    const context = Constructor ? new Constructor() : null
    const text = () => {
      if (!ready() || document.activeElement !== host) return
      active = binding; lastHost = host
      mirror()
      if (composing) measure()
      else transfer()
    }
    const start = () => {
      if (!ready()) return
      active = binding; lastHost = host; composing = true
      compositionStart = context?.selectionStart ?? 0
      host.setAttribute("data-ails-question-entry", "true")
      options().show()
      transitionUntil = performance.now() + 260
      trackEntrance()
    }
    const end = () => {
      mirror()
      const closeRequested = closeAfterComposition
      closeAfterComposition = false
      clearComposition()
      if (closeRequested) options().hide()
      else queueMicrotask(transfer)
    }
    const bounds = (event: Event) => measure(event as QuestionCharacterBoundsEvent)
    const format = (event: Event) => { formats = (event as QuestionTextFormatEvent).getTextFormats(); measure() }
    const focus = () => { active = binding; lastHost = host; sync(binding); attach(binding) }
    const binding: Binding = { host, context, dispose: () => {
      for (const [name, listener] of listeners) context?.removeEventListener(name, listener)
      if (host.editContext === context) host.editContext = null
      host.removeAttribute("data-ails-question-reader"); host.removeAttribute("data-ails-question-entry")
      host.removeEventListener("focus", focus)
    } }
    const listeners = [["textupdate", text], ["compositionstart", start], ["compositionend", end],
      ["characterboundsupdate", bounds], ["textformatupdate", format]] as const
    host.setAttribute("data-ails-question-reader", "true")
    host.addEventListener("focus", focus)
    for (const [name, listener] of listeners) context?.addEventListener(name, listener)
    bindings.set(host, binding); sync(binding); attach(binding)
  }
  const readerFor = (target: EventTarget | null) => target instanceof Element ? target.closest<QuestionReader>(SURFACES) : null
  // A file row may contain a native editor. Its input and paste take priority
  // over the row's type-to-chat shortcut, including while rename focus settles.
  const textEntry = (event: Event) => [event.target, document.activeElement].some(
    target => target instanceof Element && (target.closest(TEXT_CONTROLS) || (target instanceof HTMLElement && target.isContentEditable)),
  )
  const focusReader = () => {
    if (focusFrame || pointerDown || !bindings.size || !document.hasFocus()) return
    const focused = document.activeElement
    if (focused === options().input && options().open) return
    if (focused && focused !== document.body && focused !== document.documentElement && focused !== options().input) return
    if (!ready() || selected()) return
    const hosts = Array.from(bindings.keys())
    const host = lastHost && bindings.has(lastHost) ? lastHost : hosts.find(host => !host.hasAttribute("data-ails-quick-chat-proxy")) ?? hosts[0]
    host?.focus({ preventScroll: true })
  }
  const close = () => {
    clearComposition(); options().hide()
    options().input?.blur()
    focusReader()
  }
  const refresh = () => {
    const fullscreen = document.querySelector("[data-ails-fullscreen-viewer]")
    const hosts = ready() ? Array.from((fullscreen ?? document).querySelectorAll<QuestionReader>(SURFACES)).filter(visible) : []
    for (const [host, binding] of bindings) if (!hosts.includes(host)) {
      if (active === binding) { clearComposition(); active = null }
      if (document.activeElement === host && hosts.length) host.blur()
      binding.dispose(); bindings.delete(host)
    }
    for (const host of hosts) bind(host)
    const focusedHost = readerFor(document.activeElement), binding = focusedHost && bindings.get(focusedHost)
    if (binding && !composing && !options().open) sync(binding)
    if (!options().open && document.activeElement === options().input) {
      // Let the textarea's native deletion finish before attaching the reader's
      // EditContext; Chromium otherwise scrolls its new selection into view.
      if (!focusFrame) focusFrame = requestAnimationFrame(() => { focusFrame = 0; focusReader() })
      options().input?.blur()
    }
    focusReader()
  }
  const selection = () => {
    if (composing || pointerDown) return
    for (const binding of bindings.values()) attach(binding)
    if (!selected()) focusReader()
  }
  const down = (event: PointerEvent) => {
    pointerDown = true
    const form = options().input?.form
    if (event.target instanceof Node && form?.contains(event.target)) return
    if (options().open) {
      if (composing) { closeAfterComposition = true; active?.host.blur() }
      else options().hide()
    }
    const host = readerFor(event.target)
    if (!host || (event.target instanceof Element && event.target.closest(CONTROLS))) return
    lastHost = host
    const binding = bindings.get(host)
    if (binding && !composing) host.editContext = null
  }
  const up = () => { pointerDown = false }
  const click = (event: MouseEvent) => {
    const host = readerFor(event.target)
    if (!host || !ready() || selected() || (event.target instanceof Element && event.target.closest(CONTROLS))) return
    bind(host); lastHost = host
    const binding = bindings.get(host)
    if (binding) { attach(binding); sync(binding); host.focus({ preventScroll: true }) }
  }
  const key = (event: KeyboardEvent) => {
    if (!ready() || event.defaultPrevented || textEntry(event)) return
    const host = readerFor(document.activeElement), binding = host && bindings.get(host)
    const typing = event.key === "Process" || event.keyCode === 229 || (event.key.length === 1 && event.key !== " ")
    const fileTyping = typing && event.target instanceof Element && event.target.closest("[data-ails-workspace-item]")
    const chatTyping = typing && event.target instanceof Element && event.target.closest("[data-ails-quick-chat-proxy]")
    if (!binding || (!fileTyping && !chatTyping && event.target instanceof Element && event.target.closest(CONTROLS))) return
    if (typing && !event.ctrlKey && !event.metaKey && !event.altKey && !composing) {
      if (host!.editContext !== binding.context) host!.editContext = binding.context
      if (document.activeElement !== host) { sync(binding); host!.focus({ preventScroll: true }) }
    }
    if (event.key === "Escape" && options().open && !composing && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault(); event.stopImmediatePropagation(); close(); return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !composing) {
      host!.editContext = null
      return // Document selection and Home's file-selection handler keep Ctrl+A.
    }
    if (binding.context || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key.length === 1 || event.key === "Process" || event.keyCode === 229) {
      options().show()
      const input = options().input
      if (!input) return
      if (event.key.length === 1) {
        event.preventDefault()
        input.value += event.key
        options().change(input.value)
        options().resize?.()
      }
      input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length)
    }
  }
  const paste = (event: ClipboardEvent) => {
    const host = readerFor(document.activeElement)
    if (!host || !bindings.has(host) || !ready() || composing || event.defaultPrevented || textEntry(event)) return
    const value = event.clipboardData?.getData("text/plain")
    if (!value) return
    event.preventDefault(); event.stopPropagation()
    options().show()
    const input = options().input
    if (!input) return
    input.value += value; options().change(input.value)
    options().resize?.()
    input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length)
  }
  const refreshBounds = () => measure()
  document.addEventListener("pointerdown", down, true)
  document.addEventListener("pointerup", up, true)
  document.addEventListener("pointercancel", up, true)
  document.addEventListener("click", click)
  document.addEventListener("selectionchange", selection)
  document.addEventListener("paste", paste, true)
  document.addEventListener("scroll", refreshBounds, true)
  window.addEventListener("keydown", key, true)
  window.addEventListener("focus", focusReader)
  window.addEventListener("resize", refreshBounds)
  return { refresh, close, dispose: () => {
    if (focusFrame) cancelAnimationFrame(focusFrame)
    clearComposition()
    for (const binding of bindings.values()) binding.dispose()
    bindings.clear()
    document.removeEventListener("pointerdown", down, true)
    document.removeEventListener("pointerup", up, true)
    document.removeEventListener("pointercancel", up, true)
    document.removeEventListener("click", click)
    document.removeEventListener("selectionchange", selection)
    document.removeEventListener("paste", paste, true)
    document.removeEventListener("scroll", refreshBounds, true)
    window.removeEventListener("keydown", key, true)
    window.removeEventListener("focus", focusReader)
    window.removeEventListener("resize", refreshBounds)
  } }
}
