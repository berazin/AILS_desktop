import {
  Bookmark,
  Copy,
  FileText,
  Minus,
  Square,
  X,
} from "lucide-react"
import { useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"

import ailsProcessbarLogoUrl from "../../../../../assets/AILS_white.png?url"
import { getAppDesktopApi, type AppWindowResizeDirection } from "../../../lib/desktop-api.ts"
import { t } from "../../../lib/i18n.ts"
import type { WorkspaceTab } from "../../../shared/workspace-types.ts"
import { ProcessBarTabs } from "./process-bar-tabs.tsx"
import { LiquidProcessbarHoverSurface } from "./liquid-processbar-hover-surface.tsx"

type DesktopTitleBarProps = {
  actions: {
    clearVoiceError: () => void
    closeTab: (docId: string) => void
    goBack: () => void
    goForward: () => void
    goHome: () => void
    newTab: () => void
    openBookmarks: () => void
    openCodePractice: () => void
    openFeedback: () => void
    openQuestionHistory: () => void | Promise<void>
    selectTab: (docId: string) => void
    setFullscreen?: (fullscreen: boolean) => void
    toggleMaximizedFallback: () => void
  }
  fullscreen: boolean
  fullscreenOnMaximize?: boolean
  insight?: ReactNode
  learningTools?: ReactNode
  moreTools?: ReactNode
  practice?: { open: () => void }
  isMaximized: boolean
  navigation: {
    activeHomeTabId: string
    activeDocId: string
    canGoBack: boolean
    canGoForward: boolean
    isHome: boolean
    isFolderNavigation?: boolean
    canCloseLastTab?: boolean
    onCloseHomeTab: (tabId: string) => void
    onSelectHomeTab: (tabId: string) => void
    tabs: WorkspaceTab[]
    splitIds?: readonly string[]
    splitGroups?: readonly (readonly string[])[]
    onSplitTab?: (id: string) => void
    onUnsplitTab?: (id: string) => void
    onReorderTabs?: (ids: string[]) => void
  }
  onResizeMouseDown: (direction: AppWindowResizeDirection, event: ReactMouseEvent<HTMLDivElement>) => void
  pdf: {
    active: boolean
    bookmarkCount: number
    bookmarked: boolean
  }
  voiceError: string
}

export function DesktopTitleBar({
  actions,
  fullscreen,
  fullscreenOnMaximize = false,
  insight,
  learningTools,
  moreTools,
  practice,
  isMaximized,
  navigation,
  onResizeMouseDown,
  pdf,
  voiceError,
}: DesktopTitleBarProps) {
  const processbarRef = useRef<HTMLDivElement | null>(null)
  function toggleMaximized() {
    const api = getAppDesktopApi()
    if (fullscreen) {
      if (actions.setFullscreen) actions.setFullscreen(false)
      else void api?.set_fullscreen?.(false)
      return
    }
    if (fullscreenOnMaximize && !isMaximized && actions.setFullscreen) {
      actions.setFullscreen(true)
      return
    }
    if (api?.maximize) {
      void api.maximize()
      if (!api.on_maximize_change) actions.toggleMaximizedFallback()
    } else {
      actions.toggleMaximizedFallback()
    }
  }

  return (
    <>
      {!fullscreen && !isMaximized && (
        <div className="pointer-events-none fixed inset-0 z-[120]" aria-hidden="true">
          <div className="pointer-events-auto absolute left-3 right-3 top-0 h-1.5 cursor-ns-resize" style={{ WebkitAppRegion: "no-drag" } as CSSProperties} onMouseDown={(event) => onResizeMouseDown("n", event)} />
          <div className="pointer-events-auto absolute bottom-0 left-3 right-3 h-1.5 cursor-ns-resize" style={{ WebkitAppRegion: "no-drag" } as CSSProperties} onMouseDown={(event) => onResizeMouseDown("s", event)} />
          <div className="pointer-events-auto absolute bottom-3 left-0 top-3 w-1.5 cursor-ew-resize" style={{ WebkitAppRegion: "no-drag" } as CSSProperties} onMouseDown={(event) => onResizeMouseDown("w", event)} />
          <div className="pointer-events-auto absolute bottom-3 right-0 top-3 w-1.5 cursor-ew-resize" style={{ WebkitAppRegion: "no-drag" } as CSSProperties} onMouseDown={(event) => onResizeMouseDown("e", event)} />
          <div className="pointer-events-auto absolute left-0 top-0 h-3 w-3 cursor-nwse-resize" style={{ WebkitAppRegion: "no-drag" } as CSSProperties} onMouseDown={(event) => onResizeMouseDown("nw", event)} />
          <div className="pointer-events-auto absolute right-0 top-0 h-3 w-3 cursor-nesw-resize" style={{ WebkitAppRegion: "no-drag" } as CSSProperties} onMouseDown={(event) => onResizeMouseDown("ne", event)} />
          <div className="pointer-events-auto absolute bottom-0 left-0 h-3 w-3 cursor-nesw-resize" style={{ WebkitAppRegion: "no-drag" } as CSSProperties} onMouseDown={(event) => onResizeMouseDown("sw", event)} />
          <div className="pointer-events-auto absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize" style={{ WebkitAppRegion: "no-drag" } as CSSProperties} onMouseDown={(event) => onResizeMouseDown("se", event)} />
        </div>
      )}
      {(
        <div
          ref={processbarRef}
          className="desktop-drag-region ails-processbar-texture relative z-[100] flex h-8 shrink-0 items-center justify-between"
          data-ails-processbar="true"
          onDoubleClickCapture={(event) => {
            const target = event.target as Element | null
            if (!target || !event.currentTarget.contains(target) || target.closest("button, input, select, textarea, [contenteditable='true'], [role='button'], [role='tab']")) return
            toggleMaximized()
          }}
        >
          <LiquidProcessbarHoverSurface containerRef={processbarRef} />
          <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-2">
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
              data-ails-global-home-button="true"
              onClick={actions.goHome}
              title={t("홈으로 이동")}
              type="button"
            >
              <img alt="AILS" className="h-6 w-6 object-contain" data-ails-processbar-logo="true" draggable={false} src={ailsProcessbarLogoUrl} />
            </button>
            <ProcessBarTabs
              tabs={navigation.tabs}
              activeDocId={navigation.activeDocId}
              activeHomeTabId={navigation.activeHomeTabId}
              isHome={navigation.isHome}
              isFolderNavigation={navigation.isFolderNavigation}
              canGoBack={navigation.canGoBack}
              canGoForward={navigation.canGoForward}
              onNavBack={actions.goBack}
              onNavForward={actions.goForward}
              onSelectTab={actions.selectTab}
              onCloseTab={actions.closeTab}
              onNewTab={actions.newTab}
              onCloseHomeTab={navigation.onCloseHomeTab}
              canCloseLastTab={navigation.canCloseLastTab}
              onSelectHomeTab={navigation.onSelectHomeTab}
              splitIds={navigation.splitIds}
              splitGroups={navigation.splitGroups}
              onSplitTab={navigation.onSplitTab}
              onUnsplitTab={navigation.onUnsplitTab}
              onReorderTabs={navigation.onReorderTabs}
            />
            <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs font-normal" data-ails-processbar-actions="true">
              {learningTools}
              {insight}
              {practice && <button onClick={practice.open} className="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-normal text-[var(--brand)] transition-all hover:bg-[var(--brand)] hover:text-white active:scale-95" type="button" title={t("문제풀이 열기")}><FileText size={12} />{t("문제풀이")}</button>}
              {pdf.active && (
                <button
                  onClick={actions.openBookmarks}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-normal transition-all hover:bg-[var(--brand)] hover:text-white active:scale-95 ${pdf.bookmarked ? "bg-[var(--brand)]/15 text-[var(--brand)]" : "text-[var(--muted-foreground)]"}`}
                  type="button"
                  title={t("북마크 추가 / 목록 보기")}
                >
                  <Bookmark className={pdf.bookmarked ? "fill-current" : ""} size={12} />
                  {t("북마크")}{pdf.bookmarkCount > 0 ? ` ${pdf.bookmarkCount}` : ""}
                </button>
              )}
              {moreTools}
              {voiceError && (
                <div className="relative">
                  <div className="absolute right-0 top-full z-[160] mt-2 flex w-80 items-start gap-2 rounded-lg border border-red-500/30 bg-[var(--panel)] p-3 text-[10px] font-medium leading-4 text-red-400 shadow-xl" data-ails-voice-error="true" role="alert">
                    <span className="min-w-0 flex-1">{voiceError}</span>
                    <button aria-label={t("보이스 오류 닫기")} className="shrink-0 rounded p-0.5 hover:bg-red-500/10" onClick={actions.clearVoiceError} type="button"><X size={12} /></button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div data-ails-window-controls="true" className="flex h-full shrink-0 items-center">
            <button onClick={() => getAppDesktopApi()?.minimize?.()} className="flex h-full w-12 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]" type="button"><Minus size={14} /></button>
            <button aria-label={t(fullscreen || isMaximized ? "일반 화면으로 복원" : "최대화")} onClick={toggleMaximized} className="flex h-full w-12 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]" type="button">
              {fullscreen || isMaximized ? <Copy size={11} /> : <Square size={11} />}
            </button>
            <button onClick={() => getAppDesktopApi()?.close?.()} className="flex h-full w-12 items-center justify-center text-[var(--muted-foreground)] transition-colors hover:bg-red-500 hover:text-white" type="button"><X size={16} /></button>
          </div>
        </div>
      )}
    </>
  )
}
