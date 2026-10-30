import { useEffect, useState } from "react"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { normalizedMaterialPath } from "../../../lib/material-navigation.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

type Options = {
  activeDocumentId: string
  documents: ViewerDocument[]
  viewerDocument: ViewerDocument | null
  openDocument: (path: string) => Promise<ViewerDocument>
}

export function useMaterialPracticeWindows({ activeDocumentId, documents, viewerDocument, openDocument }: Options) {
  const [windows, setWindows] = useState<Record<string, string>>({})
  const openSolver = useEventCallback(async (path: string) => {
    const current = activeDocumentId && viewerDocument?.id === activeDocumentId
      && normalizedMaterialPath(viewerDocument.file_path ?? "").toLowerCase() === normalizedMaterialPath(path).toLowerCase()
      ? viewerDocument : await openDocument(path)
    setWindows(previous => ({ ...previous, [current.id]: path }))
  })
  const closeSolver = useEventCallback((documentId: string) => {
    setWindows(previous => {
      const next = { ...previous }
      delete next[documentId]
      return next
    })
  })
  useEffect(() => {
    const ids = new Set(documents.map(document => document.id))
    if (viewerDocument) ids.add(viewerDocument.id)
    setWindows(previous => Object.keys(previous).every(id => ids.has(id)) ? previous
      : Object.fromEntries(Object.entries(previous).filter(([id]) => ids.has(id))))
  }, [documents, viewerDocument])
  return { openSolver, closeSolver, activeSolverDocumentId: activeDocumentId,
    solverPath: windows[activeDocumentId] ?? "", solverWindows: Object.entries(windows).map(([documentId, path]) => ({ documentId, path })) }
}
