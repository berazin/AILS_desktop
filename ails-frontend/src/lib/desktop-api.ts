import type { TabWindowEvent, TabTransferPreviewItem, TabWorkspaceWindowState, TabGrabPoint, TabStripBounds } from "../shared/workspace-tab-transfer.ts"
import type { TabScreenPreview, TabScreenCaptureRect } from "../shared/tab-screen-preview.ts"
import type { WorkspaceClipboard } from "./workspace-clipboard.ts"

export type AppWindowResizeDirection = "n" | "s" | "w" | "e" | "nw" | "ne" | "sw" | "se"
export type AppWindowFixedPoint = "nw" | "ne" | "sw" | "se"
export type ExternalViewerFeature = "edit" | "chat" | "ocr" | "home" | "new-tab" | "materials" | "work-queue" | "insight" | "practice" | "bookmarks" | "history" | "code" | "feedback" | "search"
export type ExternalDocumentRequest = { id: string; path: string; intent?: { page?: number; zoom?: number; feature?: ExternalViewerFeature; handoffId?: string; tabs?: Array<{ path: string; page: number }> } }
export type ExternalViewerActivation = { id: string; path: string; feature: ExternalViewerFeature }

export type AppDesktopApi = {
  viewer_workspace_mounted?: () => Promise<boolean>
  viewer_workspace_presented?: (result: { id: string; error?: string; needsInput?: boolean; phase?: "activation" }) => Promise<boolean>
  on_viewer_activate?: (callback: (request: ExternalViewerActivation) => void) => () => void
  close?: () => Promise<unknown>
  on_before_close?: (callback: () => Promise<void>) => () => void
  save_office_copy?: (path: string) => Promise<{ path: string }>
  maximize?: () => Promise<unknown>
  is_maximized?: () => Promise<boolean>
  on_maximize_change?: (callback: (isMaximized: boolean) => void) => () => void
  set_fullscreen?: (fullscreen: boolean) => Promise<boolean>
  minimize?: () => Promise<unknown>
  open_external_url?: (url: string) => Promise<{ opened?: boolean }>
  open_auth_login_url?: (url: string) => Promise<{ opened?: boolean; browser?: string }>
  resize_window?: (width: number, height: number, fixedPoint: AppWindowFixedPoint) => Promise<unknown>
  start_window_resize?: (direction: AppWindowResizeDirection) => Promise<boolean>
  get_windows_speech_status?: () => Promise<{ available: boolean; engine: string; language: string; reason: string }>
  start_windows_speech?: (language?: string) => Promise<{ started: boolean; engine: string; language: string }>
  stop_windows_speech?: () => Promise<{ stopped: boolean }>
  pick_python_executable?: () => Promise<string>
  show_item_in_folder?: (path: string) => Promise<boolean>
  external_documents_ready?: () => Promise<boolean>
  has_initial_documents?: () => boolean
  initial_document_extension?: () => string
  initial_document_path?: () => string
  startup_diagnostics_enabled?: boolean
  report_document_presented?: (kind: string) => Promise<boolean>
  ack_external_document?: (id: string) => Promise<boolean>
  on_external_document?: (callback: (request: ExternalDocumentRequest) => void) => () => void
  open_path?: (path: string) => Promise<boolean>
  open_split_window?: (path: string) => Promise<boolean>
  read_workspace_clipboard?: () => Promise<WorkspaceClipboard | null>
  write_workspace_clipboard?: (value: WorkspaceClipboard, expectedId?: string) => Promise<boolean>
  clear_workspace_clipboard?: (expectedId: string) => Promise<boolean>
  on_workspace_clipboard_change?: (callback: (value: WorkspaceClipboard | null) => void) => () => void
  register_tab_strip?: (bounds: TabStripBounds, items: TabTransferPreviewItem[]) => Promise<boolean>
  capture_tab_screen?: (rect: TabScreenCaptureRect) => Promise<TabScreenPreview | null>
  tab_window_ready?: () => Promise<boolean>
  get_tab_window_state?: () => Promise<TabWorkspaceWindowState>
  close_last_tab_window?: (id: string) => Promise<boolean>
  begin_tab_drag?: (descriptor: { id: string; ids: string[]; anchor?: TabGrabPoint }) => Promise<boolean>
  finish_tab_drag?: (id: string, cancelled?: boolean, point?: { x: number; y: number }) => Promise<boolean>
  reply_tab_window?: (requestId: string, value?: unknown, error?: string) => void
  on_tab_window_event?: (callback: (event: TabWindowEvent) => void) => () => void
  on_windows_speech_event?: (callback: (event: {
    type: string
    text?: string
    error?: string
    confidence?: string
    status?: string
  }) => void) => () => void
}

export function getAppDesktopApi() {
  return (window as Window & { ailsDesktop?: { api?: AppDesktopApi } }).ailsDesktop?.api
}
