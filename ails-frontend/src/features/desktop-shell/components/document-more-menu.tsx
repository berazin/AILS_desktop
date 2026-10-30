import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, ChevronLeft, Code2, History, Languages, ListTodo, Loader2, MessageSquare, MoreHorizontal, Palette, ScanText, Settings, Sparkles, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { DocumentLearningToolsProps } from "./document-learning-tools.tsx"
import "./document-more-menu.css"
import { LiquidMoreMenuSurface } from "./liquid-more-menu-surface.tsx"

type DocumentOperation = { disabled: boolean; label: ReactNode; running: boolean; title?: string; run: () => void | Promise<void> }
export type DocumentMoreMenuProps = {
  assist?: DocumentLearningToolsProps["assist"]
  openQuestionHistory?: () => void | Promise<void>
  openCodePractice?: () => void
  codeLanguage?: string
  openWorkQueue?: () => void
  openFeedback: () => void
  ocr?: DocumentOperation
  translation?: DocumentOperation
  settings?: ReactNode
  palette?: { content: ReactNode; open: boolean; setOpen: (open: boolean) => void }
}

const itemClass = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--interactive-hover)] focus:outline-none disabled:cursor-wait disabled:opacity-50"

export function DocumentMoreMenu({ assist, openQuestionHistory, openCodePractice, codeLanguage, openWorkQueue, openFeedback, ocr, translation, settings, palette }: DocumentMoreMenuProps) {
  const [panel, setPanel] = useState<"menu" | "settings" | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const open = panel !== null || Boolean(palette?.open)

  function close(restoreFocus = false) {
    setPanel(null)
    palette?.setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close()
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        close(true)
        return
      }
      if (!containerRef.current?.contains(event.target as Node)) return
      if (event.key === "Tab" && panel === "menu") {
        close(true)
        return
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) event.stopPropagation()
      if (panel !== "menu" || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
      const items = Array.from(containerRef.current.querySelectorAll<HTMLButtonElement>("[role^='menuitem']:not(:disabled)"))
      if (!items.length) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
      items[next].focus()
    }
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", keydown, true)
    return () => {
      document.removeEventListener("pointerdown", outside, true)
      document.removeEventListener("keydown", keydown, true)
    }
  })

  useEffect(() => {
    if (panel) containerRef.current?.querySelector<HTMLButtonElement>(panel === "menu" ? "[role^='menuitem']:not(:disabled)" : "[data-close-view-settings]")?.focus()
    else if (palette?.open) containerRef.current?.querySelector<HTMLButtonElement>("[data-pdf-palette-close]")?.focus()
  }, [panel, palette?.open])

  function run(action: () => void | Promise<void>) {
    close(true)
    void action()
  }

  return <div className="relative" ref={containerRef} data-ails-document-more="true" data-ails-document-menu-open={open ? "true" : undefined} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close()
  }}>
    <button type="button" ref={triggerRef} aria-label={t("문서 더보기")} title={t("문서 더보기")} aria-expanded={open} aria-haspopup="menu"
      className="flex h-7 w-7 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]"
      onClick={() => { if (open) close(true); else setPanel("menu") }}><MoreHorizontal size={16} /></button>
    <LiquidMoreMenuSurface open={open} view={panel ?? (palette?.open ? "palette" : null)} containerRef={containerRef} triggerRef={triggerRef} />
    {panel === "menu" && <div role="menu" aria-label={t("문서 도구")} data-ails-window="true" data-ails-document-popover="true" className="absolute right-0 top-full z-[180] mt-1 max-h-[calc(100vh-48px)] w-56 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1 text-[var(--foreground)] shadow-2xl">
      {assist && <button tabIndex={-1} type="button" role="menuitemcheckbox" aria-checked={assist.enabled} disabled={assist.busy} className={itemClass}
        data-ails-ai-assist-button="true" title={`AI assist · ${assist.modelLabel}`} onClick={() => run(assist.toggle)}>
        {assist.busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}<span>AI assist</span>
        <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{assist.busy ? t("준비 중") : assist.enabled ? t("켜짐") : t("꺼짐")}</span>{assist.enabled && <Check size={13} />}
      </button>}
      {openQuestionHistory && <button tabIndex={-1} type="button" role="menuitem" className={itemClass} onClick={() => run(openQuestionHistory)}><History size={14} />{t("질문 기록")}</button>}
      {ocr && <button tabIndex={-1} type="button" role="menuitem" className={itemClass} disabled={ocr.disabled} title={t("현재 PDF 전체 OCR")} onClick={() => run(ocr.run)}>{ocr.running ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />}{ocr.label}</button>}
      {translation && <button tabIndex={-1} type="button" role="menuitem" className={itemClass} disabled={translation.disabled} title={translation.title} onClick={() => run(translation.run)}>{translation.running ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}{translation.label}</button>}
      {(settings || palette || openCodePractice || openWorkQueue) && <div role="separator" className="my-1 border-t border-[var(--border)]" />}
      {settings && <button tabIndex={-1} type="button" role="menuitem" className={itemClass} onClick={() => setPanel("settings")}><Settings size={14} />{t("PDF 보기 설정")}</button>}
      {palette && <button tabIndex={-1} type="button" role="menuitem" className={itemClass} onClick={() => { setPanel(null); palette.setOpen(true) }}><Palette size={14} />{t("팔레트")}</button>}
      {openCodePractice && <button tabIndex={-1} type="button" role="menuitem" className={itemClass} title={codeLanguage} onClick={() => run(openCodePractice)}><Code2 size={14} />{t("코드")}</button>}
      {openWorkQueue && <button tabIndex={-1} type="button" role="menuitem" className={itemClass} onClick={() => run(openWorkQueue)}><ListTodo size={14} />{t("작업 목록")}</button>}
      <button tabIndex={-1} type="button" role="menuitem" className={itemClass} onClick={() => run(openFeedback)}><MessageSquare size={14} />{t("피드백")}</button>
    </div>}
    {panel === "settings" && <section role="dialog" aria-label={t("PDF 보기 설정")} data-ails-window="true" data-ails-document-popover="true" data-pdf-wheel-scroll-region
      className="absolute right-0 top-full z-[180] mt-1 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-2xl">
      <header className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <button type="button" aria-label={t("문서 도구로 돌아가기")} onClick={() => setPanel("menu")} className="rounded p-1 hover:bg-[var(--interactive-hover)]"><ChevronLeft size={14} /></button>
        <span className="flex-1 text-xs font-semibold">{t("PDF 보기 설정")}</span>
        <button type="button" data-close-view-settings aria-label={t("보기 설정 닫기")} onClick={() => close(true)} className="rounded p-1 hover:bg-[var(--interactive-hover)]"><X size={14} /></button>
      </header>
      <div className="max-h-[calc(100vh-104px)] overflow-y-auto p-3">{settings}</div>
    </section>}
    {palette?.content}
  </div>
}
