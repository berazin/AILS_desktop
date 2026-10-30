import type { RefObject } from "react"

export function homeWorkspaceHasSelection() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-ails-home-workspace-scroll]")).some(
    (element) => element.getClientRects().length > 0 && Number(element.dataset.ailsWorkspaceSelectionCount) > 0,
  )
}

export function handleHomeQuickChatShortcut(event: KeyboardEvent, {
  inputRef, blocked, textEntryTarget, interactiveTarget, onDraftChange, setOpen, openWindow,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>
  blocked: boolean
  textEntryTarget: boolean
  interactiveTarget: boolean
  onDraftChange: (value: string) => void
  setOpen: (open: boolean) => void
  openWindow: () => void
}) {
  if (blocked || event.defaultPrevented || textEntryTarget || event.ctrlKey || event.metaKey || event.altKey) return false
  if (event.key === "Enter") {
    if (event.repeat || event.shiftKey || event.isComposing || interactiveTarget || homeWorkspaceHasSelection()) return false
    event.preventDefault()
    event.stopPropagation()
    openWindow()
    return true
  }
  const composing = event.key === "Process" || event.keyCode === 229 || event.isComposing
  if (!composing && (event.key.length !== 1 || (event.shiftKey && event.code === "Space") || (event.key === " " && interactiveTarget))) return false
  const input = inputRef.current
  if (!input || input.disabled || input.readOnly) return false
  input.focus({ preventScroll: true })
  if (!composing) {
    event.preventDefault()
    const value = input.value + event.key
    input.value = value
    onDraftChange(value)
    setOpen(Boolean(value.trim()))
  }
  input.setSelectionRange(input.value.length, input.value.length)
  return true
}
