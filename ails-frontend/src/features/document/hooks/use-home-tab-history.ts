import { useState } from "react"

export type WorkspacePageTab = { id: string; title: string; kind: "home" | "code" | "chatbot" | "settings" }
type HomeOrigin = { tab: WorkspacePageTab; documentIds: string[] }

/** Retain the Home view behind a document or page without another visible tab. */
export function useHomeTabHistory() {
  const [origins, setOrigins] = useState<Record<string, HomeOrigin>>({})

  function remember(tab: WorkspacePageTab, documentId?: string) {
    if (tab.kind !== "home") return
    setOrigins((current) => {
      const existing = current[tab.id]
      if (existing && (!documentId || existing.documentIds.includes(documentId))) return current
      return { ...current, [tab.id]: { tab, documentIds: [...(existing?.documentIds ?? []), ...(documentId ? [documentId] : [])] } }
    })
  }

  function replaceDocument(previousId: string, documentId: string) {
    setOrigins((current) => {
      let changed = false
      const updated = Object.fromEntries(Object.entries(current).map(([id, origin]) => {
        if (id === documentId || !origin.documentIds.includes(previousId)) return [id, origin]
        changed = true
        return [id, { ...origin, documentIds: [...new Set(origin.documentIds.map((value) => value === previousId ? documentId : value))] }]
      }))
      return changed ? updated : current
    })
  }

  function forget(tabId: string) {
    setOrigins((current) => {
      if (!current[tabId]) return current
      const updated = { ...current }
      delete updated[tabId]
      return updated
    })
  }

  function forDocument(documentId: string) {
    return Object.values(origins).find((origin) => origin.documentIds.includes(documentId))
  }

  function visibleId(tabId: string, tabOrder: readonly string[]) {
    const origin = origins[tabId]
    return tabOrder.find((id) => id === tabId || origin?.documentIds.includes(id))
  }

  function isHidden(documentId: string, tabOrder: readonly string[]) {
    return Boolean(forDocument(documentId)) && !tabOrder.includes(documentId)
  }

  return { origins, remember, replaceDocument, forget, forDocument, visibleId, isHidden }
}
