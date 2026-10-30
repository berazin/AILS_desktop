const CLIPBOARD_TIMEOUT_MS = 1500

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function writeClipboardText(text: string) {
  const value = text || ""
  const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard)
  if (writeText) {
    try {
      await withTimeout(writeText(value), CLIPBOARD_TIMEOUT_MS, "Clipboard write timed out")
      return
    } catch {
      // Some embedded webviews expose navigator.clipboard but never resolve the
      // permission-gated promise. Fall back to the legacy copy path below.
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    const copied = document.execCommand("copy")
    if (!copied) throw new Error("Clipboard copy was blocked")
  } finally {
    document.body.removeChild(textarea)
  }
}
