import { useEffect, useState } from 'react'
import { getAppDesktopApi, type ExternalDocumentRequest } from '../../../lib/desktop-api.ts'
import type { ViewerDocument } from '../../../lib/viewer-document.ts'

const normalized = (path: string) => path.replace(/\\/g, '/').toLowerCase()

export function useViewerWorkspaceHandoff(document: ViewerDocument | null | undefined, needsInput: boolean) {
  const [request, setRequest] = useState<ExternalDocumentRequest | null>(null)
  useEffect(() => { void getAppDesktopApi()?.viewer_workspace_mounted?.() }, [])
  useEffect(() => {
    const id = request?.intent?.handoffId
    if (!id || (!needsInput && (!document || document.loading || normalized(document.file_path) !== normalized(request.path)))) return
    let cancelled = false, frame = 0
    const ready = () => {
      if (cancelled) return
      if (!needsInput && document?.kind === 'pdf') {
        const target = normalized(document.rendered_file_path || document.file_path)
        const page = request.intent?.page || 1
        const rendered = Array.from(window.document.querySelectorAll<HTMLElement>('[data-pdf-page-number]')).some(node =>
          Number(node.dataset.pdfPageNumber) === page && normalized(node.dataset.pdfSourcePath || '') === target && node.querySelector('canvas'))
        if (!rendered) { frame = requestAnimationFrame(ready); return }
      }
      // DOM commit alone is not a presented frame. Keep the reader visible
      // through the workspace's layout and canvas paint.
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => {
        if (!cancelled) {
          void getAppDesktopApi()?.viewer_workspace_presented?.({ id, needsInput })
          setRequest(null)
        }
      }) })
    }
    frame = requestAnimationFrame(ready)
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [document, request, needsInput])
  return setRequest
}
