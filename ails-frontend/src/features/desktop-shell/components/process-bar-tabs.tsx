import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, Plus } from "lucide-react"
import { cn } from "../../../lib/utils.ts"
import { t } from "../../../lib/i18n.ts"
import { ProcessBarDocumentTab } from "./process-bar-document-tab.tsx"
import { ProcessBarSelectionSurface } from "./process-bar-selection-surface.tsx"
import { useProcessBarTabReorder } from "../hooks/use-process-bar-tab-reorder.ts"
import { useTabWindowDrag } from "../hooks/use-tab-window-drag.ts"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { ProcessBarTabHoverPreview } from "./process-bar-tab-hover-preview.tsx"

export type ProcessBarTabItem = {
  id: string
  title: string
  kind?: string
  file_path?: string
}

export type ProcessBarTabsProps = {
  tabs: ProcessBarTabItem[]
  activeHomeTabId: string
  activeDocId: string
  isHome: boolean
  isFolderNavigation?: boolean
  canGoBack: boolean
  canGoForward: boolean
  onNavBack: () => void
  onNavForward: () => void
  onSelectTab: (docId: string) => void
  onCloseTab: (docId: string) => void
  onSelectHomeTab: (tabId: string) => void
  onCloseHomeTab: (tabId: string) => void
  canCloseLastTab?: boolean
  onNewTab: () => void
  splitIds?: readonly string[]
  splitGroups?: readonly (readonly string[])[]
  onSplitTab?: (id: string) => void
  onUnsplitTab?: (id: string) => void
  onReorderTabs?: (ids: string[]) => void
}

export function ProcessBarTabs({
  tabs,
  activeHomeTabId,
  activeDocId,
  isHome,
  canGoBack,
  canGoForward,
  onNavBack,
  onNavForward,
  onSelectTab,
  onCloseTab,
  onCloseHomeTab,
  canCloseLastTab = false,
  onSelectHomeTab,
  onNewTab,
  splitIds,
  splitGroups,
  onSplitTab,
  onUnsplitTab,
  onReorderTabs,
}: ProcessBarTabsProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const groups = splitGroups ?? (splitIds ? [splitIds] : [])
  const hoverPreview = Boolean(getAppDesktopApi()?.capture_tab_screen)
  const layoutKey = JSON.stringify([tabs.map(tab => [tab.id, tab.title, tab.kind]), groups])
  const reorder = useProcessBarTabReorder(scrollContainerRef, `${layoutKey}:${activeHomeTabId}:${activeDocId}:${isHome}`, onReorderTabs)
  useTabWindowDrag(scrollContainerRef, reorder, tabs.map(tab => ({ ...tab, kind: tab.kind ?? "md" })), layoutKey)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const [canScroll, setCanScroll] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const scrollbarFrame = useRef(0)

  const measureScrollbar = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const { scrollLeft, scrollWidth, clientWidth } = container
    const maxScroll = scrollWidth - clientWidth
    const scrollable = maxScroll > 1

    setCanScroll(scrollable)

    const thumb = thumbRef.current
    if (!scrollable || !thumb) return

    const ratio = clientWidth / scrollWidth
    const calculatedWidth = Math.max(20, Math.round(clientWidth * ratio))
    const maxThumbLeft = clientWidth - calculatedWidth
    const thumbLeft = maxScroll > 0 ? (scrollLeft / maxScroll) * maxThumbLeft : 0

    thumb.style.width = `${calculatedWidth}px`
    thumb.style.transform = `translateX(${thumbLeft}px)`
  }, [])

  const updateScrollbar = useCallback(() => {
    if (scrollbarFrame.current) return
    scrollbarFrame.current = window.requestAnimationFrame(() => {
      scrollbarFrame.current = 0
      measureScrollbar()
    })
  }, [measureScrollbar])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    updateScrollbar()

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && container.scrollWidth > container.clientWidth) {
        e.preventDefault()
        container.scrollLeft += e.deltaY
      }
    }

    container.addEventListener("scroll", updateScrollbar, { passive: true })
    container.addEventListener("wheel", handleWheel, { passive: false })

    const observer = new ResizeObserver(() => {
      updateScrollbar()
    })
    observer.observe(container)
    Array.from(container.children).filter(child => !child.hasAttribute("data-processbar-selection-surface")).forEach(child => observer.observe(child))

    return () => {
      container.removeEventListener("scroll", updateScrollbar)
      container.removeEventListener("wheel", handleWheel)
      observer.disconnect()
      window.cancelAnimationFrame(scrollbarFrame.current)
      scrollbarFrame.current = 0
    }
  }, [layoutKey, updateScrollbar])

  useEffect(() => {
    // An overflowing strip creates its thumb in the following React commit.
    updateScrollbar()
  }, [canScroll, updateScrollbar])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const activeTab = container.querySelector<HTMLElement>('[data-tab-id][aria-selected="true"]')
    const activeTabEl = activeTab?.closest<HTMLElement>("[data-split-tab-group]") ?? activeTab
    if (activeTabEl) {
      activeTabEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" })
    }
  }, [activeDocId, activeHomeTabId, isHome, splitIds])

  const handleThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const container = scrollContainerRef.current
    if (!container) return

    setIsDragging(true)
    const startX = e.clientX
    const startScrollLeft = container.scrollLeft
    const { scrollWidth, clientWidth } = container
    const ratio = clientWidth / scrollWidth
    const currentThumbWidth = Math.max(20, Math.round(clientWidth * ratio))
    const maxThumbLeft = clientWidth - currentThumbWidth
    const maxScrollLeft = scrollWidth - clientWidth

    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = "none"

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (maxThumbLeft <= 0 || maxScrollLeft <= 0) return
      const deltaX = moveEvent.clientX - startX
      const scrollDelta = (deltaX / maxThumbLeft) * maxScrollLeft
      container.scrollLeft = startScrollLeft + scrollDelta
    }

    const onPointerUp = () => {
      setIsDragging(false)
      document.body.style.userSelect = prevUserSelect
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp)
  }

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-1">
      {/* Navigation: Previous (<-) and Next (->) */}
      <div className="flex items-center gap-0.5 shrink-0" data-ails-processbar-hover-group>
        <button
          type="button"
          data-ails-processbar-hover-button="back"
          disabled={!canGoBack}
          onClick={onNavBack}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded transition-colors",
            canGoBack
              ? "text-[var(--foreground)] hover:bg-[var(--interactive-hover)] active:scale-95 cursor-pointer"
              : "text-[var(--muted-foreground)] opacity-30 cursor-not-allowed",
          )}
          title={t("이전 (뒤로)")}
          aria-label={t("이전")}
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          data-ails-processbar-hover-button="forward"
          disabled={!canGoForward}
          onClick={onNavForward}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded transition-colors",
            canGoForward
              ? "text-[var(--foreground)] hover:bg-[var(--interactive-hover)] active:scale-95 cursor-pointer"
              : "text-[var(--muted-foreground)] opacity-30 cursor-not-allowed",
          )}
          title={t("다음 (앞으로)")}
          aria-label={t("다음")}
        >
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Separator */}
      <div className="h-4 w-px bg-[var(--border)]/60 mx-1 shrink-0" />

      <ProcessBarTabHoverPreview containerRef={scrollContainerRef} activeId={isHome ? activeHomeTabId : activeDocId} tabs={tabs} groups={groups} />

      {/* Tabs list with Overlay Scrollbar */}
      <div
        className="group/tabs relative flex h-full min-w-0 flex-1 items-end"
        data-ails-scrollbar-overlay-root
      >
        {/* Share the title bar backdrop so the + icon can blend with its white hover surface. */}
        <div
          ref={scrollContainerRef}
          data-ails-processbar-tab-strip
          data-ails-processbar-hover-group
          className="no-scrollbar relative flex h-full items-end gap-1 overflow-x-auto w-full px-2 scroll-px-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <ProcessBarSelectionSurface containerRef={scrollContainerRef}
            onSettled={updateScrollbar}
            selectionKey={`${isHome ? activeHomeTabId : activeDocId}:${splitIds?.join(":") ?? ""}`}
            layoutKey={layoutKey} />
          {/* 홈·문서 탭 */}
          {tabs.map((tab) => {
            const group = groups.find(ids => ids.length === 2 && ids.includes(tab.id))
            const pair = group?.map((id) => tabs.find((item) => item.id === id)) ?? []
            if (pair.length === 2 && pair.every((item) => item !== undefined) && group) {
              if (tab.id !== group[0]) return null
              const active = !isHome && group.includes(activeDocId)
              return <div key={`split-${group[0]}`} data-split-tab-group data-ails-processbar-tab data-active={active}
                className={cn("relative flex h-7 shrink-0 items-center rounded-t-xl border-x border-t",
                  active ? "border-[var(--border)] bg-[var(--background)] shadow-xs" : "border-[var(--border)]/60")}>
                <div className="flex h-full items-center overflow-hidden rounded-t-[inherit]">
                {pair.map((item, index) => item && <div key={item.id} className="flex items-center">
                  {index === 1 && <div className="h-4 w-px bg-[var(--border)]" />}
                  <ProcessBarDocumentTab tab={item} active={active} paired selectionManaged hoverPreview={hoverPreview} selected={active && item.id === activeDocId}
                    onSelect={onSelectTab} onClose={onCloseTab} onUnsplit={onUnsplitTab} />
                </div>)}
                </div>
              </div>
            }
            const homeTab = tab.kind === "home"
            const pageTab = homeTab || tab.kind === "code" || tab.kind === "chatbot" || tab.kind === "settings"
            const active = homeTab ? isHome && tab.id === activeHomeTabId : !isHome && tab.id === activeDocId
            return <ProcessBarDocumentTab key={tab.id} tab={tab} active={active} selected={active} selectionManaged hoverPreview={hoverPreview}
              canClose={!homeTab || canCloseLastTab || tabs.filter((item) => item.kind === "home").length > 1}
              onSelect={pageTab ? onSelectHomeTab : onSelectTab}
              onClose={pageTab ? onCloseHomeTab : onCloseTab}
              onSplit={pageTab ? undefined : onSplitTab} />
          })}

          {/* New Tab (+) button */}
          <button
            type="button"
            data-ails-processbar-hover-button="new-tab"
            onClick={onNewTab}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors shrink-0"
            title="새 홈 탭"
            aria-label={t("새 탭")}
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Overlay scrollbar indicator & thumb */}
        {canScroll && (
          <div
            data-ails-scrollbar-overlay
            data-dragging={isDragging}
            className="pointer-events-none absolute top-1 left-0 right-0 z-10"
            aria-hidden="true"
          >
            <div
              ref={thumbRef}
              onPointerDown={handleThumbPointerDown}
              className="h-full pointer-events-auto cursor-pointer"
              style={{ willChange: "transform, width", WebkitAppRegion: "no-drag" } as React.CSSProperties}
            />
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="h-4 w-px bg-[var(--border)]/60 mx-1 shrink-0" />
    </div>
  )
}
