import { IDE_ENABLED } from "../../../edition.ts"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { CodeSandboxWindowMode, WorkspaceSessionState } from "../../../lib/workspace-session-state.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

type Session = NonNullable<WorkspaceSessionState["codeSandbox"]>
export type PracticePdfPlacement = { floating: boolean; position: { x: number; y: number }; size: { width: number; height: number } }
type WindowState = { open: boolean; snapped: boolean; instanceKey: string; initialFileName: string; session: Session | null; pdfRestore: PracticePdfPlacement | null }
const CODE_WINDOW = "ails:standalone-code"
const emptyWindow: WindowState = { open: false, snapped: false, instanceKey: "", initialFileName: "main.py", session: null, pdfRestore: null }

function restoredWindow(session: Session): WindowState {
  return { ...emptyWindow, open: session.open === true, snapped: session.open === true && session.mode !== "code",
    initialFileName: session.activeFileName || "main.py", session }
}

export function usePracticeTabSessions(documentId: string, documentPath: string, initial: WorkspaceSessionState | null, openDocumentIds?: string[]) {
  const [mode, setMode] = useState<CodeSandboxWindowMode>(IDE_ENABLED ? initial?.codeSandbox?.mode ?? "problems" : "problems")
  const [windows, setWindows] = useState<Record<string, WindowState>>((): Record<string, WindowState> => IDE_ENABLED && initial?.codeSandbox?.mode === "code"
    ? { [CODE_WINDOW]: restoredWindow(initial.codeSandbox) } : {})
  const [restored, setRestored] = useState(false)
  const parkedWindowSequence = useRef(0)
  const key = mode === "code" ? CODE_WINDOW : documentId
  const current = windows[key] ?? emptyWindow

  useLayoutEffect(() => {
    if (restored || !documentId || !initial?.codeSandbox || initial.codeSandbox.mode === "code") return
    if (initial.material?.filePath.replace(/\\/g, "/").toLowerCase() !== documentPath.replace(/\\/g, "/").toLowerCase()) return
    const snapshot = restoredWindow(initial.codeSandbox)
    setWindows(previous => previous[documentId] ? previous : { ...previous, [documentId]: snapshot })
    setRestored(true)
  }, [documentId, documentPath, initial, restored])

  useEffect(() => {
    if (!openDocumentIds) return
    const ids = new Set([CODE_WINDOW, documentId, ...openDocumentIds])
    setWindows(previous => Object.keys(previous).every(id => ids.has(id)) ? previous
      : Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id))))
  }, [documentId, openDocumentIds])

  const update = useEventCallback((change: Partial<WindowState> | ((previous: WindowState) => Partial<WindowState>), nextMode: CodeSandboxWindowMode = mode) => {
    if (!IDE_ENABLED && nextMode === "code") return
    const target = nextMode === "code" ? CODE_WINDOW : documentId
    if (!target) return
    setMode(nextMode)
    setWindows(previous => {
      const window = previous[target] ?? emptyWindow
      return { ...previous, [target]: { ...window, ...(typeof change === "function" ? change(window) : change) } }
    })
  })
  const replaceDocument = useEventCallback((previousId: string, nextId: string, { retainPrevious = false }: { retainPrevious?: boolean } = {}) => {
    if (!previousId || !nextId || previousId === nextId) return
    const parkedInstanceKey = `ails:parked-practice:${++parkedWindowSequence.current}`
    setWindows(previous => {
      const source = previous[previousId]
      if (!source) return previous
      const target = previous[nextId]
      const carried = source.open ? {
        ...(target ?? source), open: true, snapped: source.snapped,
        instanceKey: source.instanceKey || previousId, pdfRestore: source.pdfRestore,
        session: target?.session ? { ...target.session, open: true } : source.session,
      } : target ?? source
      const next = { ...previous, [nextId]: carried }
      // An existing destination tab leaves the source tab available independently.
      if (retainPrevious && source.open) next[previousId] = { ...source, instanceKey: parkedInstanceKey }
      else if (!retainPrevious) delete next[previousId]
      return next
    })
  })
  return { ...current, mode, key, update, replaceDocument }
}
