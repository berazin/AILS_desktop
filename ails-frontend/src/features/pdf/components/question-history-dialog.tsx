import { History, Loader2, Trash2, X } from "lucide-react"

import { chatbotQuestionForDisplay } from "../../../lib/chatbot-display.ts"
import { t } from "../../../lib/i18n.ts"
import type { PdfStudyChatConcept } from "../../../lib/api"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import { Button } from "../../../shared/ui/button.tsx"

export function QuestionHistoryDialog({
  concepts,
  deletePendingId,
  documentTitle,
  error,
  loading,
  onCancelDelete,
  onClose,
  onConfirmDelete,
  onDeleteIntent,
  onRetry,
  open,
}: {
  concepts: PdfStudyChatConcept[]
  deletePendingId: string
  documentTitle?: string
  error: string
  loading: boolean
  onCancelDelete: () => void
  onClose: () => void
  onConfirmDelete: (turnId: string) => void
  onDeleteIntent: (turnId: string) => void
  onRetry: () => void
  open: boolean
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[72] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        aria-modal="true"
        className="flex max-h-[calc(100vh-32px)] w-[min(760px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold"><History size={17} /> {t("질문 기록")}</h2>
            <p className="mt-1 truncate text-xs text-[var(--muted-foreground)]">
              {documentTitle ?? t("현재 PDF")} {t("· 다시 볼 개념 ")}{concepts.length}{t("개")}</p>
          </div>
          <Button aria-label={t("질문 기록 닫기")} onClick={onClose} size="icon" variant="ghost">
            <X size={18} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="animate-spin" size={17} /> {t("불러오는 중")}</div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
              <p>{error}</p>
              <Button className="mt-3" onClick={onRetry} size="sm" variant="outline">{t("다시 시도")}</Button>
            </div>
          ) : concepts.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">{t("저장된 질문 기록이 없습니다.")}</div>
          ) : concepts.map((item) => (
            <article className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4" key={item.turn_id}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
                <span className="truncate font-semibold text-[var(--foreground)]">{item.document_title}</span>
                <span className="flex items-center gap-2">
                  <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("ko-KR")}</time>
                  {deletePendingId === item.turn_id ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 hover:bg-black/5"
                        onClick={onCancelDelete}
                      >
                        {t("취소")}</button>
                      <button
                        type="button"
                        className="rounded bg-red-500/10 px-1.5 py-0.5 font-bold text-red-500 hover:bg-red-500/20"
                        onClick={() => onConfirmDelete(item.turn_id)}
                      >
                        {t("삭제")}</button>
                    </span>
                  ) : (
                    <button
                      aria-label={t("이 질문 기록 삭제")}
                      className="rounded p-1 text-[var(--muted-foreground)] transition hover:bg-red-500/10 hover:text-red-500"
                      onClick={() => onDeleteIntent(item.turn_id)}
                      title={t("삭제")}
                      type="button"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>
              <div className="mt-2 text-sm font-semibold">{chatbotQuestionForDisplay(item.question)}</div>
              <div className="mt-3 rounded-lg bg-[var(--muted)] px-3 py-2 text-sm">
                <MarkdownViewer content={item.concept_summary} enableLooseLatexRepair />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
