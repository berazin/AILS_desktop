/** Document-only shortcuts, dispatched before the viewer's quick-chat keys. */
export function handleInsightInputShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.metaKey || event.shiftKey || event.isComposing) return false
  // Windows Korean IME can report the first key as Process/229. KeyI lets
  // the document shortcut run before composition starts in background chat.
  const toggleKey = event.ctrlKey && (event.key.toLowerCase() === "i" || event.key === "ㅑ" || event.code === "KeyI")
  const escapeKey = !event.ctrlKey && event.key === "Escape" && event.keyCode !== 229
  if (!toggleKey && !escapeKey && (event.ctrlKey || event.key !== "Enter" || event.keyCode === 229)) return false
  const anchor = document.querySelector<HTMLButtonElement>("[data-ails-insight-shortcut='true']")
  if (!anchor || anchor.disabled || !anchor.getClientRects().length) return false
  const popup = document.querySelector<HTMLFormElement>("[data-ails-insight-input='true']")
  const input = popup?.querySelector<HTMLTextAreaElement>("textarea")
  const target = document.activeElement
  const inInsightInput = target === input
  const inInsightPopup = target instanceof HTMLElement && Boolean(popup?.contains(target))
  const backgroundChat = target instanceof HTMLTextAreaElement
    && target.dataset.ailsQuickChatBackgroundInput === "true" && !target.value.trim()
    && !target.disabled && !target.readOnly
  const editable = target instanceof HTMLElement && (target.isContentEditable
    || Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .monaco-editor")))
  const interactive = target instanceof HTMLElement
    && Boolean(target.closest("button, a, [role='button']"))
  let action: (() => void) | undefined
  if ((escapeKey && popup) || (toggleKey && (inInsightPopup || !editable || backgroundChat))) {
    action = () => {
      if (!popup) {
        // The opening key's native IME events must finish on a non-editable
        // target, before the newly mounted textarea takes focus.
        anchor.dataset.ailsInsightOpeningKey = "true"
      }
      anchor.focus({ preventScroll: true })
      anchor.click()
    }
  } else if (event.key === "Enter" && input && !input.disabled) {
    if (inInsightInput && !input.value.trim()) {
      action = () => anchor.focus({ preventScroll: true })
    } else if (!inInsightInput && (!editable || backgroundChat) && (!interactive || target === anchor)) {
      action = () => input.focus({ preventScroll: true })
    }
  }
  if (!action) return false
  event.preventDefault()
  event.stopPropagation()
  if (!event.repeat) action()
  return true
}
