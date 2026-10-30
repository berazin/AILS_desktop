import type { ViewerDocument } from "../lib/viewer-document.ts"

export type TransferPageTab = { id: string; title: string; kind: "home" | "code" | "chatbot" | "settings" }
export type TransferWorkspace = { id: string; path: string; name: string; available: boolean; opened: number; pdfs: { id: string; path: string; available: boolean }[] }
export type DocumentEditTransfer = { id: string; draft: string; editing: boolean; undo: string[]; redo: string[] }
export type TransferSplitGroup = { pair: [string, string]; ratio: number; fit?: { id: string; aspect: number | null } | null; linkSource?: string }
export type WorkspaceTabTransfer = {
  version: 1
  ids: string[]
  activeId: string
  documents: ViewerDocument[]
  pages: TransferPageTab[]
  origins: { tab: TransferPageTab; documentIds: string[] }[]
  folders: TransferWorkspace[]
  split: [string, string] | null
  groups?: TransferSplitGroup[]
  ratio: number
  fit?: { id: string; aspect: number | null } | null
  linkSource?: string
  folderDrafts: Record<string, string>
  homePaths: Record<string, string>
  pdfPages: Record<string, number>
  editing?: DocumentEditTransfer | null
}
export type TabTransferPreviewItem = { id: string; title: string; kind: string }
export type TabGrabPoint = { x: number; y: number }
export type TabStripBounds = { x: number; y: number; width: number; height: number; tabOrigin?: TabGrabPoint }
export type TabWorkspaceWindowState = { count: number; canCloseLastTab: boolean }
export type TabWindowEvent = {
  type: "collect" | "receive" | "remove" | "insertion" | "preview" | "drag-position" | "drag-stopped" | "error" | "window-state" | "transfer-ready"
  windowState?: TabWorkspaceWindowState
  requestId?: string
  dragId?: string
  ids?: string[]
  payload?: WorkspaceTabTransfer
  preview?: TabTransferPreviewItem[] | null
  point?: { x: number; y: number }
  beforeId?: string | null
  floating?: boolean
  previewing?: boolean
  replace?: boolean
  own?: boolean
  message?: string
}
