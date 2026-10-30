import { IDE_ENABLED, documentAllowed } from "../../../lib/ide-policy.ts"
import { useLayoutEffect, useMemo, useRef, useState } from "react"

import type { DashboardRecentFile } from "../../../shared/workspace-types.ts"
import { useSelectedReport } from "./use-selected-report.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import { t } from "../../../lib/i18n.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { useHomeTabHistory, type WorkspacePageTab } from "./use-home-tab-history.ts"
import type { WorkspaceTabTransfer } from "../../../shared/workspace-tab-transfer.ts"
import { canCloseOffice, getOfficeSession } from '../../office/session.ts'

type UseDocumentWorkspaceOptions = {
  closeSettings: () => void
  setNotice: (notice: string) => void
  settingsOpen: boolean
}

const PAGE_SURFACES = { home: "dashboard", code: "code", chatbot: "home", settings: "settings" } as const
const PAGE_TITLES = { code: "코드", chatbot: "챗봇", settings: "설정" } as const

const MAX_CLOSED_TAB_HISTORY = 20

function readRecentFiles() {
  try {
    const saved = localStorage.getItem("ails-recent-files")
    return saved ? (JSON.parse(saved) as DashboardRecentFile[]) : []
  } catch {
    return []
  }
}

export function useDocumentWorkspace({
  closeSettings,
  setNotice,
  settingsOpen,
}: UseDocumentWorkspaceOptions) {
  const reports = useSelectedReport({ setNotice })
  const { selectedReport, setSelectedReport, setSelectedReportId } = reports
  const [documents, setDocuments] = useState<ViewerDocument[]>([])
  const [selectedDocumentId, setSelectedDocumentId] = useState("")
  // 홈에서 코드·챗봇으로 이동해도 같은 페이지 탭의 ID와 위치를 유지한다.
  const [homeTabs, setHomeTabs] = useState<WorkspacePageTab[]>([{ id: "ails:home:1", title: t("홈"), kind: "home" }])
  const [activeHomeTabId, setActiveHomeTabId] = useState("ails:home:1")
  const [tabOrder, setTabOrder] = useState(["ails:home:1"])
  const homeHistory = useHomeTabHistory()
  const nextHomeTabNumber = useRef(2)
  const [recentFiles, setRecentFiles] = useState<DashboardRecentFile[]>(readRecentFiles)
  const [surface, setSurface] = useState<WorkspaceSurface>("dashboard")
  const [mdMoreMenuOpen, setMdMoreMenuOpen] = useState(false)
  // Ctrl+Shift+T 복구용 닫힌 탭 스택. 렌더에 쓰이지 않아 ref만으로 관리한다.
  const closedTabsRef = useRef<ViewerDocument[]>([])

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  )
  const sessionDocument: ViewerDocument | null = selectedReport
    ? {
        id: selectedReport.id,
        title: selectedReport.title,
        kind: "md",
        content: selectedReport.content,
        raw_content: selectedReport.raw_content,
        file_path: selectedReport.file_path,
        source: "session",
      }
    : null
  const viewerDocument = surface === "home" || surface === "code" ? null : selectedDocument ?? sessionDocument
  const viewerDocumentRef = useRef(viewerDocument)
  useLayoutEffect(() => {
    const saved = (event: Event) => {
      const { id, path } = (event as CustomEvent<{ id: string; path: string }>).detail
      setDocuments(current => current.map(doc => doc.id === id ? { ...doc, file_path: path, title: path.split(/[\\/]/).pop() ?? doc.title } : doc))
    }
    const close = (event: Event) => closeDocumentTab((event as CustomEvent<string>).detail)
    window.addEventListener('ails:office-saved', saved); window.addEventListener('ails:office-close-ready', close)
    return () => { window.removeEventListener('ails:office-saved', saved); window.removeEventListener('ails:office-close-ready', close) }
  })
  useLayoutEffect(() => {
    viewerDocumentRef.current = viewerDocument
  }, [viewerDocument])

  function revealTabs(ids: readonly string[]) {
    const origins = ids.flatMap((id) => { const origin = homeHistory.forDocument(id); return origin ? [{ id, origin }] : [] })
    if (!origins.length) return
    setHomeTabs((current) => current.filter((tab) => !origins.some(({ origin }) => origin.tab.id === tab.id)))
    setTabOrder((current) => {
      let next = current
      for (const { id, origin } of origins) {
        if (next.includes(id)) continue
        const previousId = homeHistory.visibleId(origin.tab.id, next)
        if (!previousId) continue
        const index = next.indexOf(previousId)
        next = ids.includes(previousId) ? [...next.slice(0, index + 1), id, ...next.slice(index + 1)]
          : next.map((item) => item === previousId ? id : item)
      }
      return next
    })
  }

  function selectDocumentTab(documentId: string) {
    revealTabs([documentId])
    setSelectedDocumentId(documentId)
    setSelectedReportId("")
    setSurface("document")
  }

  function selectHomeTab(tabId: string, kind?: WorkspacePageTab["kind"]) {
    const existing = homeTabs.find((tab) => tab.id === tabId) ?? homeHistory.origins[tabId]?.tab
    if (!existing) return
    const tab = kind ? { ...existing, kind, title: t(kind === "home" ? "홈" : PAGE_TITLES[kind]) } : existing
    if (!homeTabs.some((item) => item.id === tabId)) {
      setHomeTabs((current) => [...current, tab])
      const previousId = homeHistory.visibleId(tabId, tabOrder)
      if (previousId) setTabOrder((current) => current.map((id) => id === previousId ? tabId : id))
    } else if (existing.kind !== tab.kind) {
      setHomeTabs((current) => current.map((item) => item.id === tabId ? tab : item))
    }
    activatePageTab(tab)
  }

  function activatePageTab(tab: WorkspacePageTab) {
    if (settingsOpen && !homeTabs.some((page) => page.kind === "settings")) closeSettings()
    setActiveHomeTabId(tab.id)
    setSelectedDocumentId("")
    setSelectedReportId("")
    setSelectedReport(null)
    setSurface(PAGE_SURFACES[tab.kind])
  }

  function openPageTab(kind: "code" | "chatbot" | "settings", replaceCurrentHome = true) {
    if (!IDE_ENABLED && kind === "code") return
    const currentHome = replaceCurrentHome && surface === "dashboard"
      ? homeTabs.find((tab) => tab.id === activeHomeTabId && tab.kind === "home") : undefined
    if (currentHome && kind === "code") homeHistory.remember(currentHome)
    const existing = currentHome ?? homeTabs.find((tab) => tab.kind === kind)
    const tab: WorkspacePageTab = { id: existing?.id ?? `ails:home:${nextHomeTabNumber.current++}`, title: t(PAGE_TITLES[kind]), kind }
    setHomeTabs((current) => existing ? current.map((item) => item.id === existing.id ? tab : item) : [...current, tab])
    if (!existing) setTabOrder((current) => [...current, tab.id])
    activatePageTab(tab)
  }

  function closeHomeTab(tabId: string, isActive = activeHomeTabId === tabId && homeTabs.some((tab) => tab.id === tabId && PAGE_SURFACES[tab.kind] === surface), selectPageTab = selectHomeTab) {
    const closing = homeTabs.find((tab) => tab.id === tabId)
    if (!closing) return
    const remaining = homeTabs.filter((tab) => tab.id !== tabId)
    const retainedIds = homeHistory.origins[tabId]?.documentIds ?? []
    if (retainedIds.some(id => !canCloseOffice(id))) return
    homeHistory.forget(tabId)
    if (retainedIds.length) setDocuments((current) => current.filter((document) => !retainedIds.includes(document.id)))
    setHomeTabs(remaining)
    setTabOrder((current) => current.filter((id) => id !== tabId))
    if (isActive) {
      if (remaining.length) selectPageTab(remaining[remaining.length - 1].id)
      else if (documents.some((document) => !retainedIds.includes(document.id))) {
        selectDocumentTab(documents.filter((document) => !retainedIds.includes(document.id)).at(-1)!.id)
      }
      else openNewTab()
    }
  }

  function replaceTabId(previousId: string, documentId: string) {
    const retainedDocument = Boolean(homeHistory.forDocument(previousId) || homeHistory.forDocument(documentId))
    homeHistory.replaceDocument(previousId, documentId)
    setTabOrder((current) => {
      if (current.includes(documentId) && (!previousId || documents.some((document) => document.id === documentId))) {
        return current.filter((id) => id !== previousId || id === documentId)
      }
      const withoutObsoleteId = current.filter((id) => id !== documentId || id === previousId)
      return current.includes(previousId)
        ? withoutObsoleteId.map((id) => id === previousId ? documentId : id)
        : retainedDocument ? current : [...withoutObsoleteId, documentId]
    })
  }

  function replaceHomeTab(tabId: string, documentId: string) {
    // Opening an already visible document selects its tab and keeps this Home.
    if (tabOrder.includes(documentId) && documents.some((document) => document.id === documentId)) return
    const tab = homeHistory.origins[tabId]?.tab ?? homeTabs.find((item) => item.id === tabId)
    if (tab) homeHistory.remember(tab, documentId)
    setHomeTabs((current) => current.filter((tab) => tab.id !== tabId))
    replaceTabId(tabId, documentId)
  }

  function restoreHomeTab(tabId: string, pendingId: string) {
    setHomeTabs((current) => current.some((tab) => tab.id === tabId) ? current : [...current, { id: tabId, title: t("홈"), kind: "home" }])
    replaceTabId(pendingId, tabId)
    setSelectedDocumentId((current) => {
      if (current !== pendingId) return current
      setActiveHomeTabId(tabId)
      setSurface("dashboard")
      return ""
    })
  }

  function orderTabs<T extends { id: string; title: string; kind: string }>(workbenchTabs: T[]) {
    const tabs = [...homeTabs, ...workbenchTabs.filter((tab) => !homeHistory.isHidden(tab.id, tabOrder))]
    const byId = new Map(tabs.map((tab) => [tab.id, tab]))
    return [...tabOrder.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), ...tabs.filter((tab) => !tabOrder.includes(tab.id))]
  }

  function reorderTabs(ids: string[]) {
    // Reordering only changes presentation; selection, cached documents and
    // the retained Home origin history keep their identities.
    const ordered = [...new Set(ids)]
    setTabOrder((current) => ordered.length === current.length && ordered.every((id, index) => id === current[index])
      ? current : [...ordered, ...current.filter((id) => !ordered.includes(id))])
  }

  function collectTransferredTabs(ids: string[]) {
    const origins = Object.values(homeHistory.origins).filter(origin => ids.includes(origin.tab.id) || origin.documentIds.some(id => ids.includes(id)))
    const retained = new Set([...ids, ...origins.flatMap(origin => origin.documentIds)])
    for (const id of retained) {
      const session = getOfficeSession(id)
      if (session?.dirty || session?.busy) throw new Error('편집 중인 문서를 저장한 뒤 창 사이로 이동하세요.')
      if (session?.engine?.synchronize) throw new Error('한글 편집 탭의 창 사이 이동은 아직 지원하지 않습니다. 저장 후 대상 창에서 파일을 다시 여세요.')
    }
    return { pages: homeTabs.filter(tab => ids.includes(tab.id)), documents: documents.filter(document => retained.has(document.id)), origins }
  }
  function insertTransferredTabs(snapshot: Pick<WorkspaceTabTransfer, "documents" | "pages" | "origins">, order: string[], replace = false) {
    for (const tab of [...snapshot.pages, ...snapshot.origins.map(origin => origin.tab)]) {
      const number = /^ails:home:(\d+)$/.exec(tab.id)?.[1]
      if (number) nextHomeTabNumber.current = Math.max(nextHomeTabNumber.current, Number(number) + 1)
    }
    setDocuments(current => [...(replace ? [] : current), ...snapshot.documents])
    setHomeTabs(current => [...(replace ? [] : current), ...snapshot.pages])
    for (const origin of snapshot.origins) {
      homeHistory.remember(origin.tab)
      for (const id of origin.documentIds) homeHistory.remember(origin.tab, id)
    }
    setTabOrder(order)
  }
  function removeTransferredTabs(ids: string[]) {
    const snapshot = collectTransferredTabs(ids)
    const removed = new Set([...ids, ...snapshot.origins.flatMap(origin => origin.documentIds)])
    for (const origin of snapshot.origins) homeHistory.forget(origin.tab.id)
    setDocuments(current => current.filter(document => !removed.has(document.id)))
    setHomeTabs(current => current.filter(tab => !ids.includes(tab.id)))
    setTabOrder(current => current.filter(id => !removed.has(id)))
  }

  function closeDocumentTab(documentId: string, onActiveClosed?: () => void) {
    const origin = homeHistory.forDocument(documentId)
    const closingIds = origin && tabOrder.includes(documentId) ? origin.documentIds : [documentId]
    for (const id of closingIds) if (!canCloseOffice(id)) { selectDocumentTab(id); return }
    if (origin && tabOrder.includes(documentId)) homeHistory.forget(origin.tab.id)
    setTabOrder((current) => current.filter((id) => id !== documentId))
    const closing = documents.find((document) => document.id === documentId)
    if (closing) {
      closedTabsRef.current = [...closedTabsRef.current, closing].slice(-MAX_CLOSED_TAB_HISTORY)
    }
    setDocuments((current) => current.filter((document) => !closingIds.includes(document.id)))
    // State updaters can run twice in StrictMode. Navigation belongs to the event.
    if (selectedDocumentId !== documentId) return
    setSelectedDocumentId("")
    setSelectedReportId("")
    setSelectedReport(null)
    if (onActiveClosed) onActiveClosed()
    else {
      const remaining = documents.filter((document) => !closingIds.includes(document.id))
      if (remaining.length) selectDocumentTab(remaining[remaining.length - 1].id)
      else selectRemainingPageTab()
    }
  }

  function selectRemainingPageTab() {
    const page = homeTabs.at(-1)
    if (page) activatePageTab(page)
    else openNewTab()
  }

  function takeClosedTab() {
    const entry = closedTabsRef.current[closedTabsRef.current.length - 1]
    if (!entry) return null
    closedTabsRef.current = closedTabsRef.current.slice(0, -1)
    return entry
  }

  function openNewTab() {
    if (settingsOpen && !homeTabs.some((page) => page.kind === "settings")) closeSettings()
    const tabId = `ails:home:${nextHomeTabNumber.current++}`
    setHomeTabs((current) => [...current, { id: tabId, title: t("홈"), kind: "home" }])
    setTabOrder((current) => [...current, ...documents.map((document) => document.id).filter((id) => !current.includes(id)), tabId])
    setActiveHomeTabId(tabId)
    setSelectedDocumentId("")
    setSelectedReportId("")
    setSelectedReport(null)
    setSurface("dashboard")
  }

  function goHomeTab(currentTabId = selectedDocumentId || activeHomeTabId, visibleTabIds = tabOrder) {
    const currentPage = homeTabs.find((tab) => tab.id === currentTabId)
    const origin = homeHistory.forDocument(currentTabId)
    const previous = currentPage ?? origin?.tab
    const tab: WorkspacePageTab = { id: previous?.id ?? `ails:home:${nextHomeTabNumber.current++}`, title: t("홈"), kind: "home" }
    if (!previous && currentTabId) homeHistory.remember(tab, currentTabId)
    setHomeTabs((current) => current.some((item) => item.id === tab.id)
      ? current.map((item) => item.id === tab.id ? tab : item) : [...current, tab])
    setTabOrder(() => visibleTabIds.includes(currentTabId)
      ? visibleTabIds.map((id) => id === currentTabId ? tab.id : id) : [...visibleTabIds, tab.id])
    activatePageTab(tab)
  }

  return {
    reports,
    actions: {
      closeDocumentTab,
      closeHomeTab,
      goHomeTab,
      revealTabs: useEventCallback(revealTabs),
      retainedTabIds: (tabId: string) => homeHistory.origins[tabId]?.documentIds ?? [],
      openNewTab,
      openPageTab,
      orderTabs,
      reorderTabs: useEventCallback(reorderTabs),
      collectTransferredTabs,
      activateTransferredPage: activatePageTab,
      insertTransferredTabs: useEventCallback(insertTransferredTabs),
      removeTransferredTabs: useEventCallback(removeTransferredTabs),
      replaceHomeTab: useEventCallback(replaceHomeTab),
      replaceTabId: useEventCallback(replaceTabId),
      restoreHomeTab: useEventCallback(restoreHomeTab),
      selectHomeTab,
      selectRemainingPageTab,
      selectDocumentTab,
      takeClosedTab,
    },
    documents: {
      activeHomeTabId,
      homeTabs,
      cachedHomeTabIds: [...new Set([...homeTabs.filter((tab) => tab.kind === "home").map((tab) => tab.id), ...Object.keys(homeHistory.origins)])],
      items: documents,
      selected: selectedDocument,
      selectedId: selectedDocumentId,
      session: sessionDocument,
      setItems: setDocuments,
      setSelectedId: setSelectedDocumentId,
      viewer: viewerDocument,
      viewerRef: viewerDocumentRef,
    },
    recent: {
      files: recentFiles.filter(file => documentAllowed(file.path)),
      setFiles: setRecentFiles,
    },
    surface: {
      set: setSurface,
      value: surface,
    },
    ui: {
      mdMoreMenuOpen,
      setMdMoreMenuOpen,
    },
  }
}

export type DocumentWorkspace = ReturnType<typeof useDocumentWorkspace>
