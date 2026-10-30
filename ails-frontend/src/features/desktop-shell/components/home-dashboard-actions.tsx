import { IDE_ENABLED } from "../../../edition.ts"
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Code2, FileText, FolderOpen, HelpCircle, Languages, ListTodo, MessageSquare, MoreHorizontal, ScanText, Settings, Sparkles } from "lucide-react"
import { openFileDialog } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
/* @ails-feature:insight_book:start */
import { InsightBookLauncher } from "../../insight-book/insight-book-launcher.tsx"
/* @ails-feature:insight_book:end */
import type { HomeQuickActions } from "./home-workspace.tsx"
import { useHomeMenuFade } from "../hooks/use-home-menu-fade.ts"
import "./home-menu-fade.css"

const toolClass = "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-white/65 dark:hover:bg-white/[0.06] dark:hover:text-white"

export function HomeDashboardActions({ accountKey, quickActions, mdSavePath, onOpenSource, recentFiles, favorites, searchContent }: {
  accountKey?: string
  quickActions: HomeQuickActions
  mdSavePath: string
  onOpenSource: (path: string) => void
  recentFiles: ReactNode
  favorites?: ReactNode
  searchContent?: ReactNode
}) {
  const { open: moreMenuOpen, present: moreMenuVisible, setOpen: setMoreMenuOpen, onTransitionEnd } = useHomeMenuFade("open")
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!moreMenuOpen) return
    const container = moreMenuRef.current
    const menu = popupRef.current
    if (!container || !menu) return
    const positionMenu = () => {
      const rect = container.getBoundingClientRect()
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`
      menu.style.top = `${rect.bottom + 4}px`
      menu.style.maxHeight = `${Math.max(0, window.innerHeight - rect.bottom - 12)}px`
    }
    positionMenu()
    window.addEventListener("resize", positionMenu)
    return () => window.removeEventListener("resize", positionMenu)
  }, [moreMenuOpen])
  useEffect(() => {
    if (!moreMenuOpen) return
    const closeOutside = (event: MouseEvent) => {
      if (!moreMenuRef.current?.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) setMoreMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreMenuOpen(false)
    }
    document.addEventListener("mousedown", closeOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [moreMenuOpen, setMoreMenuOpen])

  function runQuickActionOnPickedFile(kind: "document" | "pdf", title: string, run: (path: string) => void) {
    void openFileDialog({ kind, title, initial_dir: mdSavePath })
      .then((result) => { if (result.path) run(result.path) })
      .catch(() => { /* Keep cancelled native dialogs silent. */ })
  }

  return <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-slate-200/80 px-6 py-2 dark:border-white/[0.08]" data-ails-home-quick-actions="true">
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5" data-ails-home-quick-tools="true">
      {recentFiles}
      {favorites}
      {IDE_ENABLED && <button type="button" className={toolClass} onClick={quickActions.openCode}><Code2 size={15} />{t("코드")}</button>}
      {/* @ails-feature:insight_book:start */}
      <InsightBookLauncher key={accountKey} className={toolClass} materialRoot={mdSavePath} onOpenSource={onOpenSource} />
      {/* @ails-feature:insight_book:end */}
      <button type="button" className={toolClass} onClick={quickActions.openWorkQueue}><ListTodo size={15} />{t("작업 목록")}</button>
      <div className="relative shrink-0" ref={moreMenuRef}>
        <button type="button" className={toolClass} aria-expanded={moreMenuOpen} aria-haspopup="menu" onClick={() => setMoreMenuOpen((open) => !open)}><MoreHorizontal size={15} />{t("더보기")}</button>
        {moreMenuVisible && createPortal(<div ref={popupRef} role="menu" aria-label={t("더보기")} aria-hidden={!moreMenuOpen} inert={!moreMenuOpen} data-open={moreMenuOpen}
          onTransitionEnd={onTransitionEnd}
          className="ails-home-menu-fade fixed z-[110] w-40 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#181c2b]">
          <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); runQuickActionOnPickedFile("document", t("자료 파일 열기"), quickActions.openFile) }}><FileText size={14} />{t("파일 열기")}<kbd className="ml-auto text-[10px] text-slate-400">Ctrl O</kbd></button>
      {IDE_ENABLED && <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); quickActions.openFolder() }}><FolderOpen size={14} />{t("폴더 열기")}</button>}
          <div role="separator" className="my-1 border-t border-slate-200 dark:border-white/10" />
          <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); runQuickActionOnPickedFile("pdf", t("OCR을 실행할 PDF 선택"), quickActions.runOcr) }}><ScanText size={14} />{t("OCR")}</button>
          <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); runQuickActionOnPickedFile("pdf", t("번역할 PDF 선택"), quickActions.runTranslation) }}><Languages size={14} />{t("번역")}</button>
          <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); quickActions.openSummary() }}><Sparkles size={14} />{t("요약")}</button>
          <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); quickActions.openPractice() }}><FileText size={14} />{t("연습문제")}</button>
          <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); quickActions.openChatbot() }} title={t("챗봇 화면으로 이동")}><MessageSquare size={14} />{t("챗봇")}</button>
          <div role="separator" className="my-1 border-t border-slate-200 dark:border-white/10" />
          <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); quickActions.openSettings() }}><Settings size={14} />{t("설정")}</button>
          <button type="button" role="menuitem" className={`${toolClass} w-full`} onClick={() => { setMoreMenuOpen(false); quickActions.openHelp() }}><HelpCircle size={14} />{t("도움말 가이드")}</button>
        </div>, document.body)}
      </div>
    </div>
    {searchContent}
  </header>
}
