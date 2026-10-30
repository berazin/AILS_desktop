import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import type { WorkspaceClipboard } from "../../../lib/workspace-clipboard.ts"

let value: WorkspaceClipboard | null = null
let revision = 0
const listeners = new Set<() => void>()

function publish(next: WorkspaceClipboard | null) {
  if (JSON.stringify(value) === JSON.stringify(next)) return
  value = next
  for (const listener of listeners) listener()
}

export function workspaceClipboardSnapshot() { return value }

export async function readWorkspaceClipboard() {
  const sequence = ++revision
  const read = getAppDesktopApi()?.read_workspace_clipboard
  const next = read ? await read() : value
  if (sequence === revision) publish(next)
  return next
}

export async function writeWorkspaceClipboard(next: WorkspaceClipboard, expectedId?: string) {
  ++revision
  const write = getAppDesktopApi()?.write_workspace_clipboard
  if (write) {
    await write(next, expectedId)
    await readWorkspaceClipboard()
  } else if (expectedId === undefined || value?.id === expectedId) publish(next)
}

export async function clearWorkspaceClipboard(expectedId: string) {
  ++revision
  const clear = getAppDesktopApi()?.clear_workspace_clipboard
  if (clear) {
    await clear(expectedId)
    await readWorkspaceClipboard()
  } else if (value?.id === expectedId) publish(null)
}

export function subscribeWorkspaceClipboard(listener: () => void) {
  listeners.add(listener)
  const refresh = () => { void readWorkspaceClipboard().catch(() => publish(null)) }
  const nativeChange = getAppDesktopApi()?.on_workspace_clipboard_change?.(next => { ++revision; publish(next) })
  const textChange = (event: ClipboardEvent) => {
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.closest("input, textarea"))) {
      if (getAppDesktopApi()?.read_workspace_clipboard) queueMicrotask(refresh)
      else { ++revision; publish(null) }
    }
  }
  window.addEventListener("focus", refresh)
  document.addEventListener("copy", textChange)
  document.addEventListener("cut", textChange)
  refresh()
  return () => {
    listeners.delete(listener)
    nativeChange?.()
    window.removeEventListener("focus", refresh)
    document.removeEventListener("copy", textChange)
    document.removeEventListener("cut", textChange)
  }
}
