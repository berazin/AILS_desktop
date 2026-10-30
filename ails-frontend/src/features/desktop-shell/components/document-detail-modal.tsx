import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, FileCode2, FileText, FileVideo, Folder, FolderOpen, MonitorUp, Pin, PinOff, Presentation, Star, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import type { MaterialContextTarget } from "../../../lib/material-navigation.ts"
import { useDocumentDetail } from "../hooks/use-document-detail.ts"
import { useDocumentDetailDrag } from "../hooks/use-document-detail-drag.ts"
import type { MaterialItem } from "../hooks/use-materials-listing.ts"
import { sameDocumentPath, type DocumentDetailOcrJob } from "../lib/document-detail-presentation.ts"
import { DocumentDetailGeneral, DocumentDetailLearning } from "./document-detail-sections.tsx"
import "./document-detail-modal.css"

type DocumentDetailModalProps = {
  detailedModalItem: MaterialItem
  onClose: () => void
  isFavorite: boolean
  isPinned: boolean
  onOpenAtPage?: (path: string, page: number) => void
  onOpenRecent: (path: string) => void
  onToggleFavorite: (id: string) => void
  onTogglePin: (path: string) => void
  onDocumentMetaChanged?: () => void
  activeOcrJobs?: readonly DocumentDetailOcrJob[]
  onGeneratePractice?: (target: MaterialContextTarget) => void
  onSolvePractice?: (path: string) => void
  practiceSet?: { valid: boolean; question_count: number; errors?: string[] } | null
  selectionNavigation?: { index: number; count: number; onSelect: (index: number) => void }
}

export function DocumentDetailModal({ detailedModalItem, onClose, isFavorite, isPinned, onOpenAtPage,
  onOpenRecent, onToggleFavorite, onTogglePin, onDocumentMetaChanged, activeOcrJobs, onGeneratePractice, onSolvePractice, practiceSet, selectionNavigation,
}: DocumentDetailModalProps) {
  const activeOcrJob = activeOcrJobs?.find(job => sameDocumentPath(job.path, detailedModalItem.path))
  const detail = useDocumentDetail(detailedModalItem, onDocumentMetaChanged, Boolean(activeOcrJob))
  const [tab, setTab] = useState<"general" | "learning">("general")
  const [moreOpen, setMoreOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [actionError, setActionError] = useState("")
  const panel = useRef<HTMLElement>(null)
  const windowDrag = useDocumentDetailDrag(panel)
  const moreButton = useRef<HTMLButtonElement>(null)
  const moreMenu = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const close = useEventCallback(onClose)
  const desktop = getAppDesktopApi()
  const fileName = detailedModalItem.path.split(/[\\/]/).pop() || detailedModalItem.title
  const Icon = detailedModalItem.kind === "folder" ? Folder : ["PPT", "PPTX"].includes(detailedModalItem.kind) ? Presentation
    : detailedModalItem.kind === "MP4" ? FileVideo : detailedModalItem.kind === "IPYNB" ? FileCode2
      : detailedModalItem.kind === "EPUB" ? BookOpen : FileText

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => {
    if (!moreOpen) return
    moreMenu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    const outside = (event: MouseEvent) => {
      if (!moreMenu.current?.contains(event.target as Node) && !moreButton.current?.contains(event.target as Node)) setMoreOpen(false)
    }
    window.addEventListener("mousedown", outside)
    return () => window.removeEventListener("mousedown", outside)
  }, [moreOpen])

  function closeMenu() { setMoreOpen(false); moreButton.current?.focus() }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation()
      if (moreOpen) closeMenu(); else close()
    }
    if (event.key === "Tab") {
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), summary") ?? [])
        .filter(control => control.getClientRects().length > 0)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }

  async function copyPath() {
    setActionError("")
    try {
      await navigator.clipboard.writeText(detailedModalItem.path)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch { setActionError(t("파일 경로를 복사하지 못했습니다.")) }
  }
  function runNative(action: (() => Promise<unknown>) | undefined) {
    closeMenu(); setActionError("")
    if (!action) return
    void action().then(result => { if (result === false) setActionError(t("파일 작업을 완료하지 못했습니다.")) })
      .catch(error => setActionError(error instanceof Error ? error.message : String(error)))
  }
  const openAtPage = onOpenAtPage ? (path: string, page: number) => { close(); onOpenAtPage(path, page) } : undefined
  const resume = detail.position.page !== null
  return <div className="ails-properties-overlay fixed inset-0 z-[120] flex items-center justify-center p-3" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section className="ails-file-properties" role="dialog" aria-modal="true" aria-label={t("파일 상세정보")} style={windowDrag.style}
      aria-describedby="document-properties-name" tabIndex={-1} ref={panel} onKeyDown={keyboard} data-ails-file-properties="true">
      <div className="ails-properties-titlebar ails-processbar-texture" data-ails-properties-titlebar="true" {...windowDrag.titleBar}>
        <span><FileText size={13} aria-hidden="true" />{t("파일 상세정보")}</span>
        <button type="button" aria-label={t("닫기")} onClick={close}><X size={16} /></button>
      </div>
      {selectionNavigation && <nav className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1 text-xs" aria-label={t("선택된 파일 상세정보")}>
        <Button type="button" size="icon" variant="ghost" aria-label={t("이전 선택 파일")} disabled={selectionNavigation.index === 0}
          onClick={() => selectionNavigation.onSelect(selectionNavigation.index - 1)}><ChevronLeft size={14} /></Button>
        <span>{selectionNavigation.index + 1} / {selectionNavigation.count}</span>
        <Button type="button" size="icon" variant="ghost" aria-label={t("다음 선택 파일")} disabled={selectionNavigation.index === selectionNavigation.count - 1}
          onClick={() => selectionNavigation.onSelect(selectionNavigation.index + 1)}><ChevronRight size={14} /></Button>
      </nav>}
      <header className="ails-properties-header">
        <Icon className="ails-properties-file-icon" size={36} strokeWidth={1.5} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="document-properties-name" title={fileName}>{fileName}</h2>
          <p className="ails-properties-file-kind">{detailedModalItem.kind === "folder" ? t("파일 폴더") : detailedModalItem.kind + " · " + t("파일")}</p>
        </div>
        <div className="ails-properties-header-actions">
          <Button size="icon" variant="ghost" type="button" aria-label={isFavorite ? t("즐겨찾기 해제") : t("즐겨찾기")} aria-pressed={isFavorite}
            title={isFavorite ? t("즐겨찾기 해제") : t("즐겨찾기")} onClick={() => onToggleFavorite(detailedModalItem.id)}>
            <Star size={15} className={isFavorite ? "fill-current text-[var(--brand)]" : ""} />
          </Button>
          <Button size="icon" variant="ghost" type="button" aria-label={isPinned ? t("상단 고정 해제") : t("상단 고정")} aria-pressed={isPinned}
            title={isPinned ? t("상단 고정 해제") : t("상단 고정")} onClick={() => onTogglePin(detailedModalItem.path)}>
            {isPinned ? <PinOff size={15} className="text-[var(--brand)]" /> : <Pin size={15} />}
          </Button>
        </div>
      </header>
      <div className="ails-properties-tabs" role="tablist" aria-label={t("파일 정보 탭")}>
        {(["general", "learning"] as const).map(value => <button key={value} type="button" role="tab" data-tab={value}
          id={"properties-tab-" + value} aria-controls={"properties-panel-" + value} aria-selected={tab === value}
          tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
            event.preventDefault()
            const next = event.key === "Home" ? "general" : event.key === "End" ? "learning" : value === "general" ? "learning" : "general"
            setTab(next); panel.current?.querySelector<HTMLButtonElement>("[data-tab='" + next + "']")?.focus()
          }}>{value === "general" ? t("일반") : t("학습")}</button>)}
      </div>
      <div className="ails-properties-content" role="tabpanel" id={"properties-panel-" + tab} aria-labelledby={"properties-tab-" + tab}>
        {tab === "general"
          ? <DocumentDetailGeneral detailedModalItem={detailedModalItem} detail={detail} activeOcrJob={activeOcrJob} copied={copied} copyPath={() => void copyPath()} />
          : <DocumentDetailLearning key={detailedModalItem.path} detailedModalItem={detailedModalItem} detail={detail} onOpenAtPage={openAtPage}
              onGeneratePractice={onGeneratePractice ? target => { close(); onGeneratePractice(target) } : undefined}
              onSolvePractice={onSolvePractice ? path => { close(); onSolvePractice(path) } : undefined} practiceSet={practiceSet} />}
        {actionError && <p className="ails-properties-error" role="alert">{actionError}</p>}
      </div>
      <footer className="ails-properties-footer">
        <div className="ails-properties-more">
          <Button ref={moreButton} size="sm" variant="outline" type="button" aria-haspopup="menu" aria-expanded={moreOpen}
            aria-controls={moreOpen ? "properties-more-menu" : undefined} onClick={() => setMoreOpen(value => !value)}>{t("더보기")}<ChevronDown size={12} /></Button>
          {moreOpen && <div ref={moreMenu} className="ails-properties-menu" id="properties-more-menu" role="menu" aria-label={t("파일 작업")}
            onKeyDown={event => {
              const buttons = Array.from(moreMenu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault()
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
                buttons[next]?.focus()
              }
            }}>
            <button type="button" role="menuitem" onClick={() => {
              if (desktop?.open_split_window) runNative(() => desktop.open_split_window!(detailedModalItem.path))
              else { closeMenu(); window.open("/?openMaterial=" + encodeURIComponent(detailedModalItem.path), "_blank") }
            }}><ExternalLink size={14} />{t("새 창(분할 창)으로 열기")}</button>
            <button type="button" role="menuitem" disabled={!desktop?.open_path} onClick={() => runNative(() => desktop!.open_path!(detailedModalItem.path))}><MonitorUp size={14} />{t("외부 뷰어로 열기")}</button>
            <button type="button" role="menuitem" disabled={!desktop?.show_item_in_folder} onClick={() => runNative(() => desktop!.show_item_in_folder!(detailedModalItem.path))}><FolderOpen size={14} />{t("파일 위치 열기")}</button>
            <button type="button" role="menuitem" onClick={() => { closeMenu(); void copyPath() }}>{copied ? <Check size={14} /> : <Copy size={14} />}{t("경로 복사")}</button>
          </div>}
        </div>
        <div><Button size="sm" variant="outline" type="button" onClick={close}>{t("닫기")}</Button>
          <Button size="sm" type="button" onClick={() => { close(); onOpenRecent(detailedModalItem.path) }}>
            {detailedModalItem.kind === "folder" ? <FolderOpen size={14} /> : <BookOpen size={14} />}
            {detailedModalItem.kind === "folder" ? t("폴더 열기") : resume ? t("이어서 읽기") : t("열기")}
          </Button></div>
      </footer>
    </section>
  </div>
}
