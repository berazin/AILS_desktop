import type { CodeConsoleEncoding } from "../../../lib/api.ts"

export const CONSOLE_ENCODING_KEY = "ails-code-console-encoding"
export const CONSOLE_ENCODING_EVENT = "ails-code-console-encoding-change"

export function normalizeConsoleEncoding(value: unknown): CodeConsoleEncoding {
  return value === "utf-8" || value === "cp949" ? value : "auto"
}

export function readConsoleEncoding(): CodeConsoleEncoding {
  try { return normalizeConsoleEncoding(localStorage.getItem(CONSOLE_ENCODING_KEY)) }
  catch { return "auto" }
}

export function changeConsoleEncoding(value: string) {
  localStorage.setItem(CONSOLE_ENCODING_KEY, normalizeConsoleEncoding(value))
  window.dispatchEvent(new Event(CONSOLE_ENCODING_EVENT))
}

export function subscribeConsoleEncoding(callback: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === CONSOLE_ENCODING_KEY || event.key === null) callback()
  }
  window.addEventListener(CONSOLE_ENCODING_EVENT, callback)
  window.addEventListener("storage", storageChanged)
  return () => {
    window.removeEventListener(CONSOLE_ENCODING_EVENT, callback)
    window.removeEventListener("storage", storageChanged)
  }
}
