import { useEffect } from "react"
import { IDE_ENABLED, documentAllowed, IDE_DISABLED_MESSAGE } from '../../../lib/ide-policy.ts'
import { useEventCallback } from '../../../shared/hooks/use-event-callback.ts'
import { shouldOpenSourceFile } from './workspace-source-file.ts'

type OpenOptions = { newTab?: boolean; homeTabId?: string; reload?: boolean }

export function useWorkspaceFileOpen(
  openDocument: (path: string, options?: OpenOptions) => Promise<void>,
  openSource: (path: string) => Promise<void>,
  setNotice: (message: string) => void,
) {
  useEffect(() => {
    if (IDE_ENABLED) return
    const drop = (event: DragEvent) => {
      const transfer = event.dataTransfer
      const material = transfer?.getData("application/x-ails-material-file")
      const blocked = material && !documentAllowed(material)
        || Array.from(transfer?.files ?? []).some(file => !documentAllowed(file.name))
      if (!blocked) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setNotice(IDE_DISABLED_MESSAGE)
    }
    window.addEventListener("drop", drop, true)
    return () => window.removeEventListener("drop", drop, true)
  }, [setNotice])
  return useEventCallback(async (path: string, options?: OpenOptions) => {
    if (!documentAllowed(path)) { setNotice(IDE_DISABLED_MESSAGE); return }
    if (!IDE_ENABLED || !await shouldOpenSourceFile(path)) return openDocument(path, options)
    try { await openSource(path) }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
  })
}
