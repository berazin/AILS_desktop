import type { LectureMaterialsPayload } from "../../../lib/api"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { t } from "../../../lib/i18n.ts"
import { ViewerDocumentHeader } from "./viewer-document-header.tsx"

export type DocumentHeaderActionsProps = {
  document: ViewerDocument | null
  materials?: LectureMaterialsPayload | null
  editing: { active: boolean; enter: () => void; leave: (save: boolean) => unknown }
  menu: {
    open: boolean
    fullscreen?: boolean
    onOpenFullscreen: () => void
    onRunLatexPostprocess: () => void
    setNotice: (notice: string) => void
    setOpen: (open: boolean) => void
  }
}

export function DocumentHeaderActions({ document, editing, menu, materials = null }: DocumentHeaderActionsProps) {
  return <ViewerDocumentHeader document={document} materials={materials} editing={{
    active: editing.active,
    toggle: () => { if (editing.active) void editing.leave(true); else editing.enter() },
  }} menu={{
    open: menu.open, fullscreen: menu.fullscreen, setOpen: menu.setOpen,
    openFullscreen: menu.onOpenFullscreen, runLatexPostprocess: menu.onRunLatexPostprocess,
    copyPath: () => {
      if (!document?.file_path) return
      void navigator.clipboard.writeText(document.file_path)
      menu.setNotice(t("파일 경로를 복사했습니다."))
    },
  }} />
}
