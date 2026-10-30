import { useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react"
import { PdfJsPage } from "../../pdf/components/pdf-js-page.tsx"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import { inferPdfPageCount, viewerDocumentIsPdf, type ViewerDocument } from "../../../lib/viewer-document.ts"
import { savePdfPageForPath } from "../../pdf/lib/pdf-page-state.ts"
import { useDocumentScrollRestoration } from "../../document/hooks/use-document-scroll-restoration.ts"
import { DocumentLoadingPlaceholder } from "../../document/components/document-loading-placeholder.tsx"

export function ReferenceDocumentPane({ document, page, onPageChange, onFocus }: {
  document: ViewerDocument; page: number; onPageChange: (page: number) => void; onFocus: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  useDocumentScrollRestoration(document, scrollRef)
  const count = inferPdfPageCount(document)
  const go = (value: number) => {
    const next = Math.max(1, Math.min(count, Math.floor(value) || 1))
    onPageChange(next)
    savePdfPageForPath(document.file_path.replace(/\\/g, "/"), next)
  }
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] px-2 text-xs">
      <span className="min-w-0 flex-1 truncate">{document.title}</span>
      {viewerDocumentIsPdf(document) && <>
        <button aria-label="이전 페이지" onClick={() => go(page - 1)} disabled={page <= 1}><ChevronLeft size={14} /></button>
        <input aria-label="PDF 페이지" type="number" min={1} max={count} value={page} className="w-12 bg-transparent text-center" onChange={(event) => go(Number(event.target.value))} /> / {count}
        <button aria-label="다음 페이지" onClick={() => go(page + 1)} disabled={page >= count}><ChevronRight size={14} /></button>
        <button aria-label="축소" onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}><Minus size={13} /></button>
        <button aria-label="확대" onClick={() => setZoom((value) => Math.min(3, value + 0.1))}><Plus size={13} /></button>
      </>}
      <button className="flex items-center gap-1" title="이 문서의 전체 도구 사용" onClick={onFocus}><Maximize2 size={13} />문서 도구</button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
      {document.loading ? <DocumentLoadingPlaceholder /> : viewerDocumentIsPdf(document) ? <PdfJsPage pdfPath={document.rendered_file_path || document.file_path} pageNumber={page} pageCount={count}
        className="h-full w-full" visualScale={zoom} onNavigate={(direction) => go(page + direction)} />
        : <div className="p-5"><MarkdownViewer content={document.content} /></div>}
    </div>
  </div>
}
