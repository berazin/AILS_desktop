import { IDE_ENABLED } from "../../../edition.ts"
import { useRef } from "react"
import type { DocumentWorkspace } from "../../document/hooks/use-document-workspace.ts"
import type { FolderWorkbench } from "../../code-sandbox/workspaces/use-folder-workbench.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { SPLIT_PICKER_ID, CODE_START_ID } from "../../code-sandbox/workspaces/session.ts"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { useWorkspaceWindowLifecycle } from "./use-workspace-window-lifecycle.ts"

type SettingsTabActions = { open: () => void; close: (restoreSurface?: boolean) => void }

export function useWorkspacePageTabs(workspace: DocumentWorkspace, workbench: FolderWorkbench, settings?: SettingsTabActions) {
  const { canCloseLastTab } = useWorkspaceWindowLifecycle()
  const closing = useRef(false)
  const { surface, documents } = workspace
  const page = documents.homeTabs.find((tab) => tab.id === documents.activeHomeTabId)
  const pageActive = page && (
    (page.kind === "home" && surface.value === "dashboard")
    || (page.kind === "chatbot" && surface.value === "home")
    || (page.kind === "settings" && surface.value === "settings")
    || (page.kind === "code" && surface.value === "code" && !workbench.activeFolder && !workbench.activeSplit && workbench.activeId !== CODE_START_ID)
  )
  const activeId = pageActive ? page.id : workbench.activeId || documents.viewer?.id || ""
  const selectTab = useEventCallback((id: string) => {
    const tab = documents.homeTabs.find((tab) => tab.id === id)
    if (tab) {
      if (tab.kind === "code") workbench.start()
      if (tab.kind === "settings") settings?.open()
      workspace.actions.selectHomeTab(id)
    } else workbench.select(id)
  })
  const closeLocalTab = useEventCallback((id: string) => {
    const tabs = workspace.actions.orderTabs(workbench.tabs).filter((tab) => tab.id !== SPLIT_PICKER_ID)
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index < 0) { workbench.close(id); return }
    const remaining = tabs.filter((tab) => tab.id !== id)
    const selectRemaining = () => {
      const next = remaining[Math.min(index, remaining.length - 1)]
      if (next) selectTab(next.id)
      else workspace.actions.openNewTab()
    }
    if (documents.homeTabs.some((tab) => tab.id === id)) {
      if (documents.homeTabs.find((tab) => tab.id === id)?.kind === "settings" && !remaining.some((tab) => tab.kind === "settings")) settings?.close(false)
      for (const retainedId of workspace.actions.retainedTabIds(id)) {
        if ((workbench.splitGroups ?? (workbench.split ? [workbench.split] : [])).some(pair => pair.includes(retainedId)) || retainedId.startsWith("workspace:") || retainedId === CODE_START_ID || retainedId === SPLIT_PICKER_ID) workbench.close(retainedId)
      }
      workspace.actions.closeHomeTab(id, false)
      if (activeId === id) selectRemaining()
    } else workbench.close(id, selectRemaining)
  })
  const closeTab = useEventCallback((id: string) => {
    const tabs = workspace.actions.orderTabs(workbench.tabs).filter(tab => tab.id !== SPLIT_PICKER_ID)
    const api = getAppDesktopApi()
    if (tabs.length !== 1 || tabs[0].id !== id || !api?.close_last_tab_window) { closeLocalTab(id); return }
    if (closing.current) return
    closing.current = true
    // Electron rechecks the live window count and tab registry atomically.
    void api.close_last_tab_window(id).then(closed => {
      if (!closed) closeLocalTab(id)
    }).catch(() => { closeLocalTab(id) }).finally(() => { closing.current = false })
  })
  const closePageTab = closeTab
  const closeActive = useEventCallback(() => {
    if (activeId && activeId !== "workspace:") closeTab(activeId)
  })
  const goHome = useEventCallback(() => {
    if (page?.id === activeId && page.kind === "settings") settings?.close(false)
    workspace.actions.goHomeTab(activeId, workspace.actions.orderTabs(workbench.tabs).map((tab) => tab.id))
  })
  const openCode = useEventCallback(() => {
    if (!IDE_ENABLED) return
    workbench.start()
    workspace.actions.openPageTab("code")
  })
  const openChatbot = useEventCallback(() => workspace.actions.openPageTab("chatbot"))
  const openSettings = useEventCallback(() => {
    workspace.actions.openPageTab("settings")
    settings?.open()
  })
  const closeSettings = useEventCallback(() => {
    const tab = documents.homeTabs.find((tab) => tab.kind === "settings" && tab.id === activeId)
    if (tab) closeTab(tab.id)
    else settings?.close()
  })
  return { activeId, canCloseLastTab, goHome, closeTab, closePageTab, closeActive, selectTab, openCode, openChatbot, openSettings, closeSettings }
}
