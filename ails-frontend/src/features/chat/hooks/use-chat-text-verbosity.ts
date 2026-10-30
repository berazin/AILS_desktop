import { useSyncExternalStore } from "react"
import type { ChatTextVerbosity } from "../../../lib/api/chatbot.ts"

const STORAGE_KEY = "ails_chat_text_verbosity"
const CHANGE_EVENT = "ails-chat-text-verbosity-change"
let memoryValue: ChatTextVerbosity = "medium"

function getSnapshot(): ChatTextVerbosity {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (value === null) return memoryValue
    return value === "low" || value === "medium" || value === "high" ? value : "medium"
  } catch {
    return memoryValue
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener("storage", listener)
    window.removeEventListener(CHANGE_EVENT, listener)
  }
}

function setVerbosity(value: ChatTextVerbosity) {
  memoryValue = value
  try { window.localStorage.setItem(STORAGE_KEY, value) } catch { /* Keep the preference for this window when storage is unavailable. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useChatTextVerbosity() {
  const verbosity = useSyncExternalStore(subscribe, getSnapshot)
  return { verbosity, setVerbosity }
}
