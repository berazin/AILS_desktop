import { useEffect, useRef } from "react"

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest("input, textarea, [contenteditable='true']"))
}

export function useTextEntryActivity() {
  const activeRef = useRef(false)

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      activeRef.current = isTextEntryTarget(event.target)
    }
    const handleFocusOut = () => {
      window.setTimeout(() => {
        activeRef.current = isTextEntryTarget(document.activeElement)
      }, 0)
    }
    window.addEventListener("focusin", handleFocusIn)
    window.addEventListener("focusout", handleFocusOut)
    return () => {
      window.removeEventListener("focusin", handleFocusIn)
      window.removeEventListener("focusout", handleFocusOut)
    }
  }, [])

  return activeRef
}
