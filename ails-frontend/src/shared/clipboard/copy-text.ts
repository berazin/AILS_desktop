const CLIPBOARD_COPY_TIMEOUT_MS = 1500

function copyTextWithTextarea(text: string) {
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  Object.assign(textarea.style, { position: "fixed", left: "-9999px", top: "0", opacity: "0", pointerEvents: "none" })
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
    activeElement?.focus({ preventScroll: true })
  }
}

export async function copyTextToClipboard(text: string) {
  if (copyTextWithTextarea(text)) return
  const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard)
  if (!writeText) throw new Error("Clipboard copy was blocked")
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Clipboard write timed out")), CLIPBOARD_COPY_TIMEOUT_MS)
    writeText(text).then(
      () => { window.clearTimeout(timer); resolve() },
      error => { window.clearTimeout(timer); reject(error) },
    )
  })
}
