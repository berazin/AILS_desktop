import { useEffect } from "react"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import type { ExternalDocumentRequest } from "../../../lib/desktop-api.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { finishInitialExternalDocument } from "../lib/external-document-startup.ts"

export function useExternalDocuments(ready: boolean, open: (path: string, options: { newTab: boolean }) => Promise<unknown>, notice: (message: string) => void, afterOpen?: (request: ExternalDocumentRequest) => void | Promise<void>) {
  const handle = useEventCallback(async (request: ExternalDocumentRequest) => {
    try {
      await open(request.path, { newTab: true })
      await new Promise(resolve => window.setTimeout(resolve, 0))
      await afterOpen?.(request)
    } catch (error) {
      notice(`파일을 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`)
      if (request.intent?.handoffId) void getAppDesktopApi()?.viewer_workspace_presented?.({
        id: request.intent.handoffId, error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // Let the opened tab commit before the next queued request checks for it.
      await new Promise(resolve => window.setTimeout(resolve, 0))
      try { await getAppDesktopApi()?.ack_external_document?.(request.id) }
      finally { finishInitialExternalDocument() }
    }
  })
  useEffect(() => {
    if (!ready) return
    const api = getAppDesktopApi()
    const unsubscribe = api?.on_external_document?.(request => { void handle(request) })
    if (unsubscribe) void api?.external_documents_ready?.()
    return unsubscribe
  }, [ready, handle])
}
