import type {
  KeyboardEventHandler,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react"

import type { PdfFloatingWindow } from "../../pdf/hooks/use-pdf-floating-window.ts"
import type { NotebookController } from "../../notebook/hooks/use-notebook-controller.ts"
import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import type { PdfViewerWorkspace } from "../../pdf/hooks/use-pdf-viewer-workspace.ts"
import type { ViewerMarkdownEditorModel } from "../hooks/use-viewer-editing-workflow.ts"
import type { ChatMessage } from "../../chat/hooks/use-chat-controller.ts"
import type { LectureMaterialsPayload, PdfProblem } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { estimateDropLineIndex } from "../../../lib/viewer-editing.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import { NotebookWorkspace } from "../../notebook/components/lazy-notebook-workspace.tsx"
import { cn } from "../../../lib/utils.ts"
import type { PdfWorkspaceViewer } from "../../pdf/components/pdf-workspace-viewer.tsx"
import { ReflowDocumentViewer } from "../../../shared/components/reflow-document-viewer.tsx"
import { DocumentHeaderActions } from "./document-header-actions.tsx"
import { MarkdownDocumentSurface } from "./markdown-document-surface.tsx"
import { PlainTextDocumentSurface } from './plain-text-document-surface.tsx'
import { DocumentLoadingPlaceholder } from "./document-loading-placeholder.tsx"
import { OFFICE_KINDS } from '../../office/types.ts'
import { OfficeWorkspace } from '../../office/lazy-office-workspace.tsx'

type DocumentViewerContentProps = {
  document: ViewerDocument | null
  drag: {
    draggedAnswerId: string
    droppedLinks: Array<{ id: string; link: string; title: string }>
    getActiveDraggedAnswerId: () => string
    messages: ChatMessage[]
    onSaveAnswer: (answer: ChatMessage, lineIndex?: number) => unknown
    preview: { top: number; lineIndex?: number; message: string } | null
    restoreAfterAnswerDrag: () => void
    setPreview: (preview: { top: number; lineIndex?: number; message: string } | null) => void
    updatePreview: (clientX: number, clientY: number, container: HTMLElement) => void
  }
  editing: {
    active: boolean
    previewPending?: boolean
    editor: ViewerMarkdownEditorModel
    enter: () => void
    keyDown: KeyboardEventHandler<HTMLDivElement>
    leave: (save: boolean) => unknown
  }
  markdown: {
    onAskHighlightedText: (text: string) => void
    onHighlightText: (text: string) => void
    onImageDoubleClick: (src: string, alt: string) => void
    onOpenLocal: (href: string, event?: ReactMouseEvent<HTMLElement>) => void
  }
  menu: {
    onOpenFullscreen: () => void
    onRunLatexPostprocess: () => void
    open: boolean
    setNotice: (notice: string) => void
    setOpen: (open: boolean) => void
  }
  materials: LectureMaterialsPayload | null
  notebook: NotebookController
  pdf: {
    Viewer: typeof PdfWorkspaceViewer
    controller: PdfController
    floating: PdfFloatingWindow
    fullscreenOpen: boolean
    overlay?: (page: number) => ReactNode
    problems: {
      current: PdfProblem[]
      onSelect: (problem: PdfProblem) => void
    }
    textTools: {
      onSearch: () => void | Promise<void>
      onToggleSection: (id: string) => void
    }
    workspace: PdfViewerWorkspace
  }
  viewerScrollRef: RefObject<HTMLElement | null>
}

export function DocumentViewerContent({
  document: viewerDocument,
  drag,
  editing,
  markdown,
  materials,
  menu,
  notebook,
  pdf,
  viewerScrollRef,
}: DocumentViewerContentProps) {
  const PdfWorkspaceViewer = pdf.Viewer
  return (
    <>
      <DocumentHeaderActions document={viewerDocument} editing={editing} materials={materials} menu={menu} />

      <div
        className={cn("relative min-h-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0", viewerDocument?.kind !== "ipynb" && "overflow-x-hidden")}
        style={pdf.workspace.document.studyViewerActive || OFFICE_KINDS.has(viewerDocument?.kind ?? '') ? { height: "100%" } : undefined}
        data-ails-viewer-drop-zone="true"
        data-ails-document-search-root="true"
        data-ails-quick-chat-focus-surface={viewerDocument?.kind === "md" && !editing.active ? "true" : undefined}
        onClick={(event) => {
          if (OFFICE_KINDS.has(viewerDocument?.kind ?? '')) return
          const target = event.target
          if (
            target instanceof HTMLElement
            && (
              target.isContentEditable
              || Boolean(target.closest("input, textarea, button, select, [contenteditable='true']"))
            )
          ) return
          if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true })
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) drag.setPreview(null)
        }}
        onDragOver={(event) => {
          const activeDragAnswerId = drag.draggedAnswerId || drag.getActiveDraggedAnswerId()
          if (
            event.dataTransfer.types.includes("application/x-ails-chat-answer")
            || Boolean(activeDragAnswerId)
          ) {
            event.preventDefault()
            event.dataTransfer.dropEffect = "copy"
            drag.updatePreview(event.clientX, event.clientY, event.currentTarget)
          }
        }}
        onDrop={(event) => {
          const messageId = event.dataTransfer.getData("application/x-ails-chat-answer")
            || drag.draggedAnswerId
            || drag.getActiveDraggedAnswerId()
          if (!messageId) return
          const answer = drag.messages.find((message) => message.id === messageId)
          if (!answer) return
          event.preventDefault()
          if (viewerDocument && OFFICE_KINDS.has(viewerDocument.kind)) {
            window.dispatchEvent(new CustomEvent('ails:office-propose', { detail: { id: viewerDocument.id, text: answer.content } }))
            drag.setPreview(null)
            return
          }
          drag.restoreAfterAnswerDrag()
          const lineIndex = viewerDocument?.kind === "md"
            ? estimateDropLineIndex(
                viewerDocument.content,
                event.clientX,
                event.clientY,
                event.currentTarget,
              )
            : undefined
          drag.setPreview(null)
          void drag.onSaveAnswer(answer, lineIndex)
        }}
        onFocus={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          const container = viewerScrollRef.current
          if (!container) return
          const currentScroll = container.scrollTop
          window.requestAnimationFrame(() => {
            if (container.scrollTop !== currentScroll) container.scrollTop = currentScroll
          })
        }}
        onKeyDown={editing.keyDown}
        tabIndex={0}
      >
        {drag.preview && (
          <div
            className="pointer-events-none absolute left-2 right-2 z-20 flex items-center gap-2"
            style={{ top: drag.preview.top }}
          >
            <div className="h-px flex-1 bg-[var(--brand)]" />
            <span className="rounded-full bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white shadow">
              {drag.preview.message}
            </span>
            <div className="h-px flex-1 bg-[var(--brand)]" />
          </div>
        )}

        {viewerDocument?.loading ? <DocumentLoadingPlaceholder /> : viewerDocument && OFFICE_KINDS.has(viewerDocument.kind) ? (
          <OfficeWorkspace document={viewerDocument} onAsk={markdown.onAskHighlightedText} />
        ) : viewerDocument?.kind === 'txt' ? (
          <PlainTextDocumentSurface document={viewerDocument} />
        ) : viewerDocument?.kind === "md" ? (
          <MarkdownDocumentSurface key={viewerDocument.id} document={viewerDocument} active={editing.active} interactive={!pdf.fullscreenOpen}
            editor={editing.editor} markdown={markdown} scrollRef={viewerScrollRef} />
        ) : viewerDocument?.kind === "ipynb" && viewerDocument.content ? (
          <NotebookWorkspace
            controller={notebook}
            onOpenLocalMarkdown={markdown.onOpenLocal}
          />
        ) : viewerDocument?.document_model ? (
          <ReflowDocumentViewer document={viewerDocument.document_model} />
        ) : viewerDocument && (viewerDocument.kind === "pdf" || viewerDocument.rendered_file_path) ? (
          <PdfWorkspaceViewer
            document={viewerDocument}
            floating={pdf.floating}
            fullscreenOpen={pdf.fullscreenOpen}
            overlay={pdf.overlay}
            pdf={pdf.controller}
            problems={pdf.problems}
            textTools={pdf.textTools}
            workspace={pdf.workspace}
          />
        ) : ["ppt", "pptx"].includes(viewerDocument?.kind ?? "") && viewerDocument?.content ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            {viewerDocument.render_error && (
              <p role="alert" className="mb-3 break-words text-sm text-red-600">{viewerDocument.render_error}</p>
            )}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{t("읽기 전용 프레젠테이션 텍스트")}</span>
              <span className="text-xs text-[var(--muted-foreground)]">
                {t("PowerPoint 없이 추출한 텍스트 미리보기")}
              </span>
            </div>
            <MarkdownViewer content={viewerDocument.content} />
          </div>
        ) : (
          <div className="rounded-xl bg-[var(--muted)] p-6 text-sm text-[var(--muted-foreground)]">
            {t("표시할 정리본이 없습니다.")}
          </div>
        )}
      </div>

      {drag.droppedLinks.length > 0 && (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <h3 className="mb-2 text-sm font-semibold">{t("추가된 AI 답변 링크")}</h3>
          <div className="space-y-1 text-sm text-[var(--muted-foreground)]">
            {drag.droppedLinks.map((item) => (
              <div className="break-words font-mono text-xs" key={item.id}>{item.link}</div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
