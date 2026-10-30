import { IDE_DISABLED_MESSAGE } from "../../../lib/ide-policy.ts"
import { Activity, useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react"
import { HelpCircle, Loader2, RefreshCw, Wand2 } from "lucide-react"

import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { useTabLayoutMotion } from "../hooks/use-tab-layout-motion.ts"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { viewerDocumentUsesMarkdownLayout } from "../../../lib/viewer-document.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { DocumentViewerContent } from "../../document/components/document-viewer-content.tsx"
import { CachedTabViews } from "../../document/components/cached-tab-views.tsx"
import { useDocumentScrollRestoration } from "../../document/hooks/use-document-scroll-restoration.ts"
import { HomeAgentWorkspace } from "./home-agent-workspace.tsx"
import { hasInitialExternalDocument, waitForInitialExternalDocumentRequest } from "../lib/external-document-startup.ts"
import { DocumentLoadingPlaceholder } from "../../document/components/document-loading-placeholder.tsx"
import { LearningDashboardSurface } from "./learning-dashboard-surface.tsx"
import { HomeTabDashboards } from "./home-tab-dashboards.tsx"
import { SplitWorkspaceBrowser } from "./split-workspace-browser.tsx"
import { FolderWorkbenchLayout, type WorkbenchLayoutModel } from "../../code-sandbox/workspaces/folder-workbench-layout.tsx"
import { OFFICE_KINDS } from '../../office/types.ts'

type WorkspaceSurfaceContentProps = {
  workbench: WorkbenchLayoutModel
  surface: WorkspaceSurface
  mainScrollRef: RefObject<HTMLElement | null>
  paneRef: RefObject<HTMLElement | null>
  topRef: RefObject<HTMLDivElement | null>
  viewerScrollRef: RefObject<HTMLElement | null>
  home: {
    agent: ReactNode
    onOpenDashboard: () => void
  }
  dashboard: ComponentProps<typeof LearningDashboardSurface>
  dashboardTabs?: { activeId: string; openIds: readonly string[] }
  document: {
    available: boolean
    chat: {
      panel: ReactNode
      visible: boolean
    }
    layout: {
      lectureAddExpanded: boolean
      nonSlideCodingViewer: boolean | null
      onAutoCollapseLectureAdd: () => void
      pdfStudyViewerActive: boolean
    }
    toolbar: {
      apiError: string
      isLatexPostprocessBusy: boolean
      isRefreshBusy: boolean
      notice: string
      onLatexPostprocess: () => void
      onOpenHelp: () => void
      onRefresh: () => void
    }
    viewer: Omit<ComponentProps<typeof DocumentViewerContent>, "viewerScrollRef">
  }
}

export function WorkspaceSurfaceContent({
  workbench,
  dashboard,
  dashboardTabs,
  document,
  home,
  mainScrollRef,
  paneRef,
  surface,
  topRef,
  viewerScrollRef,
}: WorkspaceSurfaceContentProps) {
  const [openingExternal, setOpeningExternal] = useState(hasInitialExternalDocument)
  useEffect(() => {
    if (!openingExternal) return
    let cancelled = false
    void waitForInitialExternalDocumentRequest().then(() => { if (!cancelled) setOpeningExternal(false) })
    return () => { cancelled = true }
  }, [openingExternal])
  const chatSpaceRef = useRef<HTMLDivElement>(null)
  useTabLayoutMotion(chatSpaceRef, `${surface}:${document.viewer.document?.id ?? ""}`)
  const onAutoCollapseLectureAdd = useEventCallback(document.layout.onAutoCollapseLectureAdd)
  useDocumentScrollRestoration(document.viewer.document, viewerScrollRef,
    surface === "document" && document.available && !document.viewer.pdf.fullscreenOpen)

  useEffect(() => {
    if (!document.layout.lectureAddExpanded) return undefined
    const container = mainScrollRef.current
    const target = topRef.current
    if (!container || !target) return undefined

    const handleScroll = () => {
      const containerTop = container.getBoundingClientRect().top
      const targetTop = target.getBoundingClientRect().top
      if (targetTop <= containerTop + 2) onAutoCollapseLectureAdd()
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [document.layout.lectureAddExpanded, mainScrollRef, onAutoCollapseLectureAdd, topRef])

  const isDashboardVisible = !openingExternal && (surface === "dashboard"
    || (!document.available && surface !== "home" && surface !== "code" && surface !== "settings"))
  const isWorkspaceChatVisible = Boolean(document.chat.visible && (
    isDashboardVisible || (surface === "document" && document.available
      && (document.layout.pdfStudyViewerActive || viewerDocumentUsesMarkdownLayout(document.viewer.document)
        || OFFICE_KINDS.has(document.viewer.document?.kind ?? '')))
  ))
  const restoreHomeImmediately = surface === "home" || isDashboardVisible
  const officeActive = OFFICE_KINDS.has(document.viewer.document?.kind ?? '')
  const fullHeight = document.layout.pdfStudyViewerActive || officeActive
  const expandDocumentContent = document.layout.lectureAddExpanded && document.viewer.document?.kind !== "ipynb" && !officeActive

  return (
    <main
      className={cn(
        "flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--panel)] outline-none",
        restoreHomeImmediately && "transition-none",
      )}
      ref={mainScrollRef}
    >
      {document.toolbar.notice === IDE_DISABLED_MESSAGE && <div role="alert" className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">{IDE_DISABLED_MESSAGE}</div>}
      <div ref={chatSpaceRef} className={cn(
        "relative flex flex-1 min-h-0 transition-[padding] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
        isWorkspaceChatVisible && "pr-[360px]",
        restoreHomeImmediately && "transition-none",
      )}>
        <FolderWorkbenchLayout model={workbench} surface={surface} workspaceBrowser={<SplitWorkspaceBrowser dashboard={dashboard} workbench={workbench} />}
          fullscreenDocumentId={surface === 'document' && officeActive && document.viewer.pdf.fullscreenOpen ? document.viewer.document?.id : undefined}
          renderOffice={file => <DocumentViewerContent {...document.viewer} document={file} viewerScrollRef={viewerScrollRef} />}>
        {openingExternal && !document.available && <DocumentLoadingPlaceholder />}
        {surface === "settings" ? (
          <div className="h-full w-full bg-[var(--background)]" data-ails-settings-host="true" />
        ) : surface === "home" ? (
          <HomeAgentWorkspace agent={home.agent} onOpenDashboard={home.onOpenDashboard} />
        ) : null}
        {dashboardTabs ? <HomeTabDashboards activeId={isDashboardVisible ? dashboardTabs.activeId : ""}
          openIds={dashboardTabs.openIds} dashboard={dashboard} /> : <Activity mode={isDashboardVisible ? "visible" : "hidden"}>
          <LearningDashboardSurface {...dashboard} />
        </Activity>}
        <CachedTabViews activeId={surface === "document" && document.available ? document.viewer.document?.id ?? "" : ""}
          openIds={workbench.documents.map((item) => item.id)}>
          <section
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
            ref={paneRef}
          >
            <div className="hidden" style={{ display: "none" }}>
              <span>{document.toolbar.notice} {document.toolbar.apiError}</span>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-[var(--muted-foreground)]">
                    {t("정리본 뷰어 워크스페이스")}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={document.toolbar.onOpenHelp}>
                    <HelpCircle size={15} />
                    {t("도움말")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={document.toolbar.isRefreshBusy}
                    onClick={document.toolbar.onRefresh}
                  >
                    {document.toolbar.isRefreshBusy
                      ? <Loader2 className="animate-spin" size={15} />
                      : <RefreshCw size={15} />}
                    {t("목록 갱신")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={document.toolbar.isLatexPostprocessBusy}
                    onClick={document.toolbar.onLatexPostprocess}
                  >
                    {document.toolbar.isLatexPostprocessBusy
                      ? <Loader2 className="animate-spin" size={15} />
                      : <Wand2 size={15} />}
                    {t("LaTeX 후처리")}
                  </Button>
                </div>
              </div>
            </div>

            <div ref={topRef} />
            <div
              className={cn(
                "grid flex-1 grid-cols-1 gap-0",
                expandDocumentContent ? "min-h-max overflow-visible" : "min-h-0 overflow-hidden",
              )}
            >
              <article
                className={cn(
                  "min-h-0 min-w-0 outline-none",
                  fullHeight ? "overflow-hidden p-0" : "px-5 pt-0 pb-6 lg:px-7 lg:pt-0 lg:pb-8",
                  document.layout.nonSlideCodingViewer && "fixed right-0 top-0 z-[80] h-screen w-1/2 rounded-r-2xl border-l border-[var(--border)] bg-[var(--background)] shadow-2xl",
                  !fullHeight && (expandDocumentContent ? "overflow-visible" : "overflow-y-auto overflow-x-hidden"),
                )}
                ref={viewerScrollRef}
              >
                <div className={cn("mx-auto grid", fullHeight ? "h-full w-full grid-rows-1 max-w-none gap-0" : "max-w-[1500px] gap-3")}>
                  <section className={cn("min-w-0", fullHeight && "h-full min-h-0")}>
                    {!officeActive && <DocumentViewerContent {...document.viewer} viewerScrollRef={viewerScrollRef} />}
                  </section>
                </div>
              </article>
            </div>
          </section>
        </CachedTabViews>
        </FolderWorkbenchLayout>
        {isWorkspaceChatVisible && (
          <aside className="absolute inset-y-0 right-0 z-20 w-[360px] border-l border-[var(--border)] bg-[var(--panel)]">
            {document.chat.panel}
          </aside>
        )}
      </div>
    </main>
  )
}
