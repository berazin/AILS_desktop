import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react"

import type { PdfOcrDragSelection } from "../hooks/use-pdf-controller.ts"
import type { PdfProblem } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { PdfOcrTextLayer } from "./pdf-ocr-text-layer.tsx"
import { PdfProblemMarkers } from "./pdf-problem-markers.tsx"
import { PdfDocumentCaption } from "./pdf-document-caption.tsx"
import type { PdfOutlineEntry } from "../../../lib/pdf-outline.ts"

type PdfCodingOverlaysProps = {
  containedPage: {
    activePath: string
    page: number
    pageCount: number
    problems: PdfProblem[]
    rect: CSSProperties
    show: boolean
    textVisible: boolean
    onSelectProblem: (problem: PdfProblem) => void
  }
  floating: {
    active: boolean
    onResize: (direction: string, event: ReactMouseEvent) => void
  }
  selection: {
    busy: boolean
    canDragText: boolean
    codingModeActive: boolean
    hintDismissed: boolean
    value: PdfOcrDragSelection | null
  }
  title: string
  outline?: readonly PdfOutlineEntry[]
}

export function PdfCodingOverlays({ containedPage, floating, selection, title, outline = [] }: PdfCodingOverlaysProps) {
  return (
    <>
      {containedPage.show && (
        <div
          className="pointer-events-none absolute z-20"
          data-pdf-contained-page-layer="true"
          style={containedPage.rect}
        >
          <PdfOcrTextLayer
            page={containedPage.page}
            pageCount={containedPage.pageCount}
            path={containedPage.activePath}
            visible={containedPage.textVisible}
          />
          <PdfProblemMarkers problems={containedPage.problems} onSelect={containedPage.onSelectProblem} />
        </div>
      )}

      {selection.canDragText && !selection.hintDismissed && !selection.value && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded border border-[var(--border)] bg-[var(--panel)]/90 px-2 py-1 text-[10px] font-semibold text-[var(--foreground)] shadow">
          {t("텍스트 영역을 드래그하면 에디터로 옮깁니다")}
        </div>
      )}
      {selection.codingModeActive && selection.value && selection.value.page === containedPage.page && (
        <div
          className="pointer-events-none absolute z-20 flex items-start justify-start border-2 border-[var(--brand)] bg-[var(--brand-soft)]/40 shadow-[0_0_0_1px_var(--panel)]"
          style={{
            left: Math.min(selection.value.start.viewerX, selection.value.current.viewerX),
            top: Math.min(selection.value.start.viewerY, selection.value.current.viewerY),
            width: Math.abs(selection.value.current.viewerX - selection.value.start.viewerX),
            height: Math.abs(selection.value.current.viewerY - selection.value.start.viewerY),
          }}
        >
          {selection.busy && (
            <span className="m-1 rounded bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
              {t("텍스트 가져오는 중...")}
            </span>
          )}
        </div>
      )}

      {floating.active && (
        <>
          <div className="absolute left-1 right-1 top-0 z-[90] h-1.5 cursor-n-resize" onMouseDown={(event) => floating.onResize("n", event)} />
          <div className="absolute bottom-0 left-1 right-1 z-[90] h-1.5 cursor-s-resize" onMouseDown={(event) => floating.onResize("s", event)} />
          <div className="absolute bottom-1 left-0 top-1 z-[90] w-1.5 cursor-w-resize" onMouseDown={(event) => floating.onResize("w", event)} />
          <div className="absolute bottom-1 right-0 top-1 z-[90] w-1.5 cursor-e-resize" onMouseDown={(event) => floating.onResize("e", event)} />
          <div className="absolute left-0 top-0 z-[90] h-3 w-3 cursor-nw-resize" onMouseDown={(event) => floating.onResize("nw", event)} />
          <div className="absolute right-0 top-0 z-[90] h-3 w-3 cursor-ne-resize" onMouseDown={(event) => floating.onResize("ne", event)} />
          <div className="absolute bottom-0 left-0 z-[90] h-3 w-3 cursor-sw-resize" onMouseDown={(event) => floating.onResize("sw", event)} />
          <div className="absolute bottom-0 right-0 z-[90] h-3 w-3 cursor-se-resize" onMouseDown={(event) => floating.onResize("se", event)} />
        </>
      )}

      <PdfDocumentCaption title={title} outline={outline} page={containedPage.page} pageCount={containedPage.pageCount} />
    </>
  )
}
