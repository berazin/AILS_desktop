import { useEffect, useState } from "react"
import { Bookmark, BookmarkX, ListPlus, X } from "lucide-react"

import type { PdfBookmark } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"

export type PdfBookmarkDialogTab = "add" | "list"

type PdfBookmarkDialogProps = {
  activeTab: PdfBookmarkDialogTab
  bookmarks: PdfBookmark[]
  currentPage: number
  onClose: () => void
  onDelete: (page: number) => void
  onGoToPage: (page: number) => void
  onSave: (page: number, label: string) => void
  onTabChange: (tab: PdfBookmarkDialogTab) => void
  open: boolean
  pageCount: number
  pdfPath: string
}

export function PdfBookmarkDialog({
  activeTab,
  bookmarks,
  currentPage,
  onClose,
  onDelete,
  onGoToPage,
  onSave,
  onTabChange,
  open,
  pageCount,
  pdfPath,
}: PdfBookmarkDialogProps) {
  const [labelDraft, setLabelDraft] = useState("")
  const currentBookmark = bookmarks.find((bookmark) => bookmark.page === currentPage)

  useEffect(() => {
    if (open) setLabelDraft("")
  }, [open, currentPage])

  if (!open) return null

  function save() {
    onSave(currentPage, labelDraft.trim())
    setLabelDraft("")
    onTabChange("list")
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center bg-black/40 pt-[14vh]" role="presentation">
      <div
        aria-label={t("북마크")}
        className="w-[26rem] overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--panel)] text-[var(--foreground)] shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Bookmark size={14} className="text-[var(--brand)]" />
            {t("북마크")}
          </div>
          <button
            aria-label={t("북마크 창 닫기")}
            className="rounded p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-[var(--border)] px-3 pt-2" role="tablist">
          {([
            { id: "add" as const, label: t("북마크 추가") },
            { id: "list" as const, label: t("북마크 목록") },
          ]).map(({ id, label: tabLabel }) => (
            <button
              aria-selected={activeTab === id}
              className={cn(
                "rounded-t-md px-3 py-1.5 text-xs font-semibold transition-colors",
                activeTab === id
                  ? "border border-b-0 border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--interactive-hover)] hover:text-[var(--foreground)]",
              )}
              key={id}
              onClick={() => onTabChange(id)}
              role="tab"
              type="button"
            >
              {tabLabel}
            </button>
          ))}
        </div>

        {activeTab === "add" ? (
          <div className="px-4 py-4">
            <p className="text-xs text-[var(--muted-foreground)]">
              {t("현재 페이지: {p0} / {p1}", { p0: String(currentPage), p1: String(pageCount) })}
            </p>
            {currentBookmark ? (
              <div className="mt-3 rounded-sm border border-[var(--border)] bg-[var(--muted)] p-3">
                <p className="text-xs font-semibold">
                  {t("이 페이지는 이미 북마크되어 있습니다")}: {currentBookmark.label || `p.${currentBookmark.page}`}
                </p>
                <button
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-sm border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-500 transition-colors hover:bg-red-500/10"
                  onClick={() => onDelete(currentPage)}
                  type="button"
                >
                  <BookmarkX size={13} />
                  {t("이 페이지 북마크 삭제")}
                </button>
              </div>
            ) : (
              <form
                className="mt-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  save()
                }}
              >
                <label className="block text-xs font-semibold" htmlFor="pdf-bookmark-label">
                  {t("북마크 이름")}
                </label>
                <input
                  autoComplete="off"
                  autoFocus
                  className="mt-1.5 w-full rounded-sm border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs outline-none focus:border-[var(--brand)]"
                  id="pdf-bookmark-label"
                  maxLength={300}
                  onChange={(event) => setLabelDraft(event.target.value)}
                  placeholder={t("예: 3장 시작, 시험 범위")}
                  value={labelDraft}
                />
                <button
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-sm bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!pdfPath}
                  type="submit"
                >
                  <Bookmark size={13} />
                  {t("현재 페이지 북마크 저장")}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="max-h-[46vh] overflow-y-auto px-4 py-3">
            {bookmarks.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">
                {t("아직 북마크가 없습니다. 페이지에서 북마크를 추가해 보세요.")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {bookmarks.map((bookmark) => (
                  <li className="group flex items-center gap-2" key={bookmark.bookmark_id}>
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm px-2 py-2 text-left transition-colors hover:bg-[var(--interactive-hover)]"
                      onClick={() => {
                        onGoToPage(bookmark.page)
                        onClose()
                      }}
                      type="button"
                    >
                      <span className="shrink-0 rounded-sm bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--muted-foreground)]">
                        p.{bookmark.page}
                      </span>
                      <span className="truncate text-xs">
                        {bookmark.label || t("p.{p0} 북마크", { p0: String(bookmark.page) })}
                      </span>
                    </button>
                    <button
                      aria-label={t("p.{p0} 북마크 삭제", { p0: String(bookmark.page) })}
                      className="shrink-0 rounded-sm p-1.5 text-[var(--muted-foreground)] opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                      onClick={() => onDelete(bookmark.page)}
                      title={t("삭제")}
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted-foreground)]">
              <ListPlus size={11} className="shrink-0" />
              <span className="truncate">{t("북마크를 클릭하면 해당 페이지로 이동합니다.")}</span>
            </div>
          </div>
        )}

        {pdfPath ? (
          <div className="border-t border-[var(--border)] px-4 py-2">
            <span className="block truncate font-mono text-[10px] text-[var(--muted-foreground)]" title={pdfPath}>
              {pdfPath.replace(/\\/g, "/")}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
