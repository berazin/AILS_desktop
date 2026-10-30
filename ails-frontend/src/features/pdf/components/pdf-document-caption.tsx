import { useMemo } from "react"
import { FileText } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { pdfChapterForPage, type PdfOutlineEntry } from "../../../lib/pdf-outline.ts"

export function PdfDocumentCaption({ title, outline, page, pageCount }: {
  title: string
  outline: readonly PdfOutlineEntry[]
  page: number
  pageCount: number
}) {
  const chapter = useMemo(() => outline.length ? pdfChapterForPage(outline, pageCount, page) : null, [outline, pageCount, page])
  const chapterLabel = chapter ? t("현재 챕터: {p0}", { p0: chapter.title }) : t("챕터 정보 없음")
  return <div
    className="ails-pdf-overlay-surface absolute bottom-3 left-3 z-10 flex max-w-[min(320px,calc(100%_-_24px))] select-none items-start gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium text-[var(--foreground)] shadow-sm backdrop-blur-sm"
    data-ails-pdf-document-caption="true" title={`${title}\n${chapterLabel}`}>
    <FileText className="mt-0.5 shrink-0 text-[var(--foreground)]" size={10} />
    <div className="min-w-0">
      <div className="truncate">{title}</div>
      <div className="truncate text-[9px] text-[var(--muted-foreground)]" data-ails-pdf-current-chapter="true">{chapterLabel}</div>
    </div>
  </div>
}
