import type { ChangeEvent, KeyboardEvent, ReactNode, RefObject } from "react"
import { PdfTextTools, type PdfTextToolsModel } from "./pdf-text-tools.tsx"

import { viewerDocumentUsesMarkdownLayout, type ViewerDocument } from "../../../lib/viewer-document.ts"
import { useDocumentScrollRestoration } from "../../document/hooks/use-document-scroll-restoration.ts"
import { DocumentLoadingPlaceholder } from "../../document/components/document-loading-placeholder.tsx"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { PdfJsPage } from "./pdf-js-page.tsx"
import { OFFICE_KINDS } from '../../office/types.ts'

type ViewerFullscreenOverlayProps = {
  active: boolean
  chat: {
    open: boolean
    panel: ReactNode
  }
  document: ViewerDocument | null
  nonPdfContent: ReactNode
  nonPdfScrollRef: RefObject<HTMLElement | null>
  pageInputRef: RefObject<HTMLInputElement | null>
  page: {
    checkpoint: number | null
    count: number
    current: number
    draft: string
    editing: boolean
    label: string
    setDraft: (value: string) => void
    setEditing: (editing: boolean) => void
    spreadActive: boolean
    submit: () => void
  }
  pdf: {
    colorMode: string
    invertTheme: boolean
    onMouseEnter: () => void
    onMouseLeave: () => void
    onNavigate: (direction: -1 | 1) => void
    overlay: ReactNode | ((pageNumber: number) => ReactNode)
    themeBrightness: number
    themeContrast: number
    viewZoom: number
    visiblePageNumbers: readonly (number | null)[]
  }
  pdfContainerRef: RefObject<HTMLDivElement | null>
  textTools: PdfTextToolsModel
}

export function ViewerFullscreenOverlay({
  active,
  chat,
  document,
  nonPdfContent,
  nonPdfScrollRef,
  page,
  pageInputRef,
  pdf,
  pdfContainerRef,
  textTools,
}: ViewerFullscreenOverlayProps) {
  useDocumentScrollRestoration(document, nonPdfScrollRef, active)
  // Office editors stay mounted in the workbench so fullscreen keeps drafts and undo.
  if (!active || !document || OFFICE_KINDS.has(document.kind)) return null

  const isSlide = document.kind === "pdf" || Boolean(document.rendered_file_path)
  const markdownLayout = viewerDocumentUsesMarkdownLayout(document)

  return (
    <div className="fixed inset-x-0 bottom-0 top-8 z-[80] bg-[var(--panel)] text-[var(--foreground)]" data-ails-fullscreen-viewer="true">
      {isSlide ? (
        <div
          className={cn(
            "relative flex h-full w-full select-none items-center justify-center overflow-hidden bg-[var(--panel)] outline-none transition-[padding] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
            chat.open && "pr-[360px]",
          )}
          data-ails-pdf-viewer="true"
          data-ails-quick-chat-focus-surface="true"
          tabIndex={0}
          onMouseEnter={pdf.onMouseEnter}
          onMouseLeave={pdf.onMouseLeave}
          ref={pdfContainerRef}
        >
          {chat.open && (
            <aside className="absolute inset-y-0 right-0 z-[88] w-[360px] border-l border-[var(--border)] bg-[var(--panel)]">
              {chat.panel}
            </aside>
          )}

          {page.editing ? (
            <input
              className="ails-pdf-overlay-surface absolute bottom-6 left-6 z-[86] w-24 rounded-full border border-[var(--border)] px-3.5 py-1.5 text-center text-xs font-bold text-[var(--foreground)] shadow-2xl backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-[var(--brand)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              max={page.count}
              min={1}
              onBlur={() => page.submit()}
              onChange={(event: ChangeEvent<HTMLInputElement>) => page.setDraft(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") page.submit()
                if (event.key === "Escape") page.setEditing(false)
              }}
              ref={pageInputRef}
              type="number"
              value={page.draft}
            />
          ) : (
            <button
              className="ails-pdf-overlay-surface absolute bottom-6 left-6 z-[85] cursor-pointer select-none rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--foreground)] shadow-sm backdrop-blur-sm"
              onClick={() => {
                page.setDraft(String(page.current))
                page.setEditing(true)
              }}
              title={t("페이지 직접 이동")}
              type="button"
            >
              {page.spreadActive ? t("페이지") : t("슬라이드")} {page.label}
            </button>
          )}

          {page.checkpoint !== null && (
            <div className="pointer-events-none absolute bottom-16 left-6 z-[85] select-none rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-black shadow-2xl">
              Checkpoint {page.checkpoint}
            </div>
          )}

          <div className={cn("pointer-events-none absolute inset-y-0 left-0 z-[90] [&>*]:pointer-events-auto", chat.open ? "right-[360px]" : "right-0")}>
            <PdfTextTools textTools={textTools} />
          </div>

          <PdfJsPage
            className="h-full w-full bg-[var(--panel)]"
            invertColors={pdf.invertTheme}
            matchThemeColors={pdf.colorMode === "theme"}
            onNavigate={pdf.onNavigate}
            overlay={pdf.overlay}
            pageCount={page.count}
            pageNumber={page.current}
            pageNumbers={pdf.visiblePageNumbers}
            pdfPath={document.rendered_file_path || document.file_path}
            themeBrightness={pdf.themeBrightness}
            themeContrast={pdf.themeContrast}
            visualScale={pdf.viewZoom}
          />
        </div>
      ) : (
        <section className={cn("relative flex h-full min-h-0 flex-col transition-[padding] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          markdownLayout && chat.open && "pr-[360px]")}>
          {markdownLayout && chat.open && (
            <aside className="absolute inset-y-0 right-0 z-[88] w-[360px] border-l border-[var(--border)] bg-[var(--panel)]">
              {chat.panel}
            </aside>
          )}
          <main className="min-h-0 flex-1 overflow-auto bg-[var(--background)] outline-none" ref={nonPdfScrollRef}
            data-ails-quick-chat-focus-surface={markdownLayout ? "true" : undefined} tabIndex={0}>
            <div data-ails-document-search-root="true" className={cn("mx-auto w-full max-w-5xl px-6 pb-6", markdownLayout ? "pt-0" : "pt-6")}>
              {document.loading ? <DocumentLoadingPlaceholder /> : nonPdfContent}
            </div>
          </main>
        </section>
      )}
    </div>
  )
}
