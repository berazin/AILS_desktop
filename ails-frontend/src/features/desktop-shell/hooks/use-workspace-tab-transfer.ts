import { IDE_ENABLED, requireDocument, IDE_DISABLED_MESSAGE } from "../../../lib/ide-policy.ts"
import { useEffect } from "react"
import { getMaterialFile } from "../../../lib/api"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { viewerFromMaterial } from "../../../lib/viewer-document.ts"
import type { WorkspaceTabTransfer, TabWindowEvent } from "../../../shared/workspace-tab-transfer.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import type { DocumentWorkspace } from "../../document/hooks/use-document-workspace.ts"
import type { useViewerEditingWorkflow } from "../../document/hooks/use-viewer-editing-workflow.ts"
import type { FolderWorkbench } from "../../code-sandbox/workspaces/use-folder-workbench.ts"
import { folderId, CODE_START_ID, SPLIT_PICKER_ID } from "../../code-sandbox/workspaces/session.ts"
import { collectFolderEditorTransfers, restoreFolderEditorTransfers, releaseFolderEditorTransfers, folderEditorTransfersUnchanged } from "../../code-sandbox/workspaces/folder-editor-transfer.ts"
import { insertWorkspaceTabIds } from "../lib/tab-insertion.ts"

type Ports = {
  workspace: DocumentWorkspace
  workbench: FolderWorkbench
  editing: ReturnType<typeof useViewerEditingWorkflow>
  activeId: string
  selectTab: (id: string) => void
  settings: { open: () => void; close: (restore?: boolean) => void }
  home: { paths: Record<string, string>; restoreFolder: (id: string, path: string) => void }
  pdf: { pages: Record<string, number>; restorePages: (pages: Record<string, number>) => void; pending?: () => number }
  notice: (message: string) => void
}
const painted = () => new Promise<void>(resolve => {
  // A newly created hidden window cannot supply animation frames on every OS.
  const timer = window.setTimeout(resolve, 120)
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve() }))
})

export function useWorkspaceTabTransfer(ports: Ports) {
  const handle = useEventCallback(async (event: TabWindowEvent) => {
    const { workspace, workbench, editing, activeId } = ports
    const api = getAppDesktopApi()
    if (event.type === "error") { ports.notice(event.message ?? "탭을 이동하지 못했습니다."); return }
    if (!event.requestId) return
    try {
      let result: unknown
      const visible = workspace.actions.orderTabs(workbench.tabs).map(tab => tab.id)
      if (event.type === "collect") {
        const ids = event.ids ?? []
        if (!ids.length || ids.some(id => !visible.includes(id))) throw new Error("드래그 중 탭 목록이 바뀌어 이동을 취소했습니다.")
        const state = workspace.actions.collectTransferredTabs(ids)
        if (ids.length === visible.length || state.documents.some(doc => doc.kind === "pdf" || doc.rendered_file_path)) {
          for (let tries = 0; (ports.pdf.pending?.() ?? 0) > 0 && tries < 100; tries++) await new Promise(resolve => setTimeout(resolve, 30))
          if ((ports.pdf.pending?.() ?? 0) > 0) throw new Error("PDF 메모 저장이 끝나지 않아 탭을 이동하지 않았습니다.")
        }
        const retained = [...new Set([...ids, ...state.origins.flatMap(origin => origin.documentIds)])]
        const folders = workbench.workspaces.filter(folder => retained.includes(`workspace:${folder.id}`))
        if (editing.state.savePending && retained.includes(editing.state.editDocumentId)) throw new Error("문서 저장이 끝난 뒤 탭을 이동해 주세요.")
        const pageKeys = state.documents.flatMap(doc => [doc.id, doc.file_path?.replace(/\\/g, "/"), doc.rendered_file_path?.replace(/\\/g, "/")])
        const groups = workbench.splitGroupsState.filter(group => group.pair.every(id => retained.includes(id)))
        const group = groups.find(item => item.pair.includes(activeId)) ?? groups[0]
        const payload: WorkspaceTabTransfer = {
          version: 1, ids, activeId: ids.includes(activeId) ? activeId : ids[0], ...state, folders,
          split: group?.pair ?? null, groups,
          ratio: group?.ratio ?? workbench.ratio, fit: group?.fit ?? workbench.documentFit, linkSource: group?.linkSource ?? workbench.linkSource,
          folderDrafts: collectFolderEditorTransfers(folders.map(folder => folder.id)),
          homePaths: Object.fromEntries(Object.entries(ports.home.paths).filter(([id]) => ids.includes(id) || state.origins.some(origin => origin.tab.id === id))),
          pdfPages: Object.fromEntries(Object.entries(ports.pdf.pages).filter(([id]) => pageKeys.includes(id))),
          editing: retained.includes(editing.state.editDocumentId) ? { id: editing.state.editDocumentId, draft: editing.state.draftContent,
            editing: editing.state.editMode, undo: editing.state.undoStack, redo: editing.state.redoStack } : null,
        }
        result = payload
      } else if (event.type === "receive" && event.payload) {
        const payload = event.payload
        if (!IDE_ENABLED) {
          if (payload.folders?.length || Object.keys(payload.folderDrafts ?? {}).length || payload.pages?.some(page => page.kind === "code")) throw new Error(IDE_DISABLED_MESSAGE)
          for (const doc of payload.documents ?? []) { requireDocument(doc.file_path); if (doc.kind === "ipynb") throw new Error(IDE_DISABLED_MESSAGE) }
        }
        let expectedIds = payload.ids
        if (payload.version !== 1 || !Array.isArray(payload.documents) || !Array.isArray(payload.pages) || !payload.ids.length) throw new Error("탭 이동 상태가 올바르지 않습니다.")
        if (event.own) {
          workspace.actions.reorderTabs(insertWorkspaceTabIds(visible, payload.ids, event.beforeId ?? null))
        } else {
          const allIds = new Set([...visible, ...workspace.documents.items.map(doc => doc.id), ...workspace.documents.cachedHomeTabIds])
          const mapping = new Map<string, string>()
          const remap = (id: string) => {
            if (folderId(id) || id === CODE_START_ID || id === SPLIT_PICKER_ID) return id
            if (!mapping.has(id)) mapping.set(id, allIds.has(id) ? `ails:transfer:${crypto.randomUUID()}` : id)
            return mapping.get(id)!
          }
          const documents = await Promise.all(payload.documents.map(async document => {
            const loaded = document.loading && document.file_path ? viewerFromMaterial((await getMaterialFile(document.file_path)).file) : document
            return { ...loaded, id: remap(document.id) }
          }))
          const pages = payload.pages.map(page => ({ ...page, id: remap(page.id) }))
          const origins = payload.origins.map(origin => ({ tab: { ...origin.tab, id: remap(origin.tab.id) }, documentIds: origin.documentIds.map(remap) }))
          const ids = payload.ids.map(remap)
          expectedIds = ids
          const incomingActive = remap(payload.activeId || payload.ids[0])
          // Draft conflicts are checked before any tab is inserted.
          restoreFolderEditorTransfers(payload.folderDrafts)
          const order = insertWorkspaceTabIds(event.replace ? [] : visible, ids, event.beforeId ?? null)
          workspace.actions.insertTransferredTabs({ documents, pages, origins }, order, event.replace)
          for (const [id, path] of Object.entries(payload.homePaths)) ports.home.restoreFolder(remap(id), path)
          ports.pdf.restorePages(Object.fromEntries(Object.entries(payload.pdfPages).map(([id, page]) => [mapping.get(id) ?? id, page])))
          const page = pages.find(tab => tab.id === incomingActive)
          workbench.acceptTransferredTabs({ ...payload, split: payload.split?.map(remap) as [string, string] | null,
            groups: payload.groups?.map(group => ({ ...group, pair: group.pair.map(remap) as [string, string],
              fit: group.fit ? { ...group.fit, id: remap(group.fit.id) } : null })),
            fit: payload.fit ? { ...payload.fit, id: remap(payload.fit.id) } : null }, incomingActive)
          if (page) {
            if (page.kind === "settings") ports.settings.open()
            if (page.kind === "code") workbench.start()
            workspace.actions.activateTransferredPage(page)
          } else if (!folderId(incomingActive) && incomingActive !== CODE_START_ID && incomingActive !== SPLIT_PICKER_ID) workspace.actions.selectDocumentTab(incomingActive)
          if (payload.editing) editing.actions.restoreTransferredEdit({ ...payload.editing, id: remap(payload.editing.id) })
        }
        await painted()
        if (expectedIds.some(id => !document.querySelector(`[data-tab-id="${CSS.escape(id)}"]`))) {
          throw new Error("받는 창에서 탭을 표시하지 못해 이동을 취소했습니다.")
        }
        result = true
      } else if (event.type === "remove") {
        const ids = event.ids ?? []
        const state = workspace.actions.collectTransferredTabs(ids)
        const expected = event.payload
        if (expected) {
          const changed = expected.documents.some(document => {
            const current = state.documents.find(item => item.id === document.id)
            return !current || (current.raw_content ?? current.content) !== (document.raw_content ?? document.content)
          }) || (expected.editing?.id === editing.state.editDocumentId && expected.editing.draft !== editing.state.draftContent)
          if (changed || !folderEditorTransfersUnchanged(expected.folderDrafts)) {
            throw new Error("이동 중 내용이 변경되어 원래 창의 탭을 유지했습니다.")
          }
        }
        const retained = [...ids, ...state.origins.flatMap(origin => origin.documentIds)]
        const remaining = visible.filter(id => !ids.includes(id))
        const wasActive = ids.includes(activeId)
        releaseFolderEditorTransfers(retained.map(folderId).filter(Boolean))
        workbench.removeTransferredTabs(retained)
        workspace.actions.removeTransferredTabs(ids)
        if (state.pages.some(page => page.kind === "settings")) ports.settings.close(false)
        if (wasActive) {
          if (remaining.length) ports.selectTab(remaining[Math.min(Math.max(0, visible.indexOf(ids[0])), remaining.length - 1)])
          else workspace.actions.openNewTab()
        }
        await painted()
        result = { empty: remaining.length === 0 }
      } else return // Insertion/preview is handled locally by the tab strip.
      api?.reply_tab_window?.(event.requestId, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      api?.reply_tab_window?.(event.requestId, undefined, message)
      ports.notice(message)
    }
  })
  useEffect(() => getAppDesktopApi()?.on_tab_window_event?.(event => { void handle(event) }), [handle])
  useEffect(() => { if (ports.workbench.ready) void getAppDesktopApi()?.tab_window_ready?.() }, [ports.workbench.ready])
}
