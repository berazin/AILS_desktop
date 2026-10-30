import { useEffect, useRef, type Dispatch, type SetStateAction } from "react"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { t } from "../../../lib/i18n.ts"

type Options = {
  selected: ViewerDocument | null
  setDocuments: Dispatch<SetStateAction<ViewerDocument[]>>
  open: (path: string, options: { reload: true }) => Promise<unknown>
  onNotice: (message: string) => void
}

/** Restored tabs load on selection. Completion only updates that tab. */
export function useDeferredDocumentOpen({ selected, setDocuments, open, onNotice }: Options) {
  const pending = useRef(new Set<string>())
  useEffect(() => {
    const doc = selected
    if (!doc?.deferred || pending.current.has(doc.id)) return
    pending.current.add(doc.id)
    setDocuments(current => current.map(item => item.id === doc.id ? { ...item, loading: true } : item))
    void open(doc.file_path, { reload: true }).catch(error => {
      onNotice(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      pending.current.delete(doc.id)
      setDocuments(current => current.map(item => item.id === doc.id && item.deferred
        ? { ...item, loading: false, deferred: false, content: t("파일을 열지 못했습니다. 파일 열기 메뉴에서 다시 시도해 주세요.") } : item))
    })
  }, [selected, setDocuments, open, onNotice])
}
