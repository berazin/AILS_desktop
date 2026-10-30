import { useCallback, useMemo, useSyncExternalStore } from "react"

const PIN_KEY = "ails-pinned-material-files"
const LEGACY_PIN_KEY = "ails-pinned-recent-files"
const PIN_EVENT = "ails-workspace-pins-changed"

export function workspacePinKey(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

function snapshot() {
  try { return localStorage.getItem(PIN_KEY) ?? localStorage.getItem(LEGACY_PIN_KEY) ?? "[]" }
  catch { return "[]" }
}

function pathsFromSnapshot(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string" && Boolean(path.trim())) : []
  } catch { return [] }
}

function subscribe(onChange: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === PIN_KEY || event.key === LEGACY_PIN_KEY) onChange()
  }
  window.addEventListener("storage", storage)
  window.addEventListener(PIN_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", storage)
    window.removeEventListener(PIN_EVENT, onChange)
  }
}

export function useWorkspacePins() {
  const stored = useSyncExternalStore(subscribe, snapshot, () => "[]")
  const pinnedPaths = useMemo(() => pathsFromSnapshot(stored), [stored])
  const togglePin = useCallback((path: string) => {
    const key = workspacePinKey(path)
    if (!key) return
    const current = pathsFromSnapshot(snapshot())
    const next = current.some((entry) => workspacePinKey(entry) === key)
      ? current.filter((entry) => workspacePinKey(entry) !== key) : [path, ...current]
    localStorage.setItem(PIN_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event(PIN_EVENT))
  }, [])
  return { pinnedPaths, togglePin }
}
