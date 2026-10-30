import type { KeyboardEvent, RefObject } from "react"
import { Loader2 } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { PdfTextTools, type PdfTextToolsModel } from "./pdf-text-tools.tsx"

type PdfViewerChromeProps = {
  floating: {
    active: boolean
    toggle: () => void
  }
  page: {
    checkpoint: number | null
    count: number
    current: number
    draft: string
    editing: boolean
    label: string
    setDraft: (value: string) => void
    setEditing: (editing: boolean) => void
    submit: () => void
  }
  pageInputRef: RefObject<HTMLInputElement | null>
  status: {
    problemError: string
    problemsAnalyzing: boolean
    problemsLoading: boolean
  }
  textTools: PdfTextToolsModel
}

export function PdfViewerChrome({ floating, page, pageInputRef, status, textTools }: PdfViewerChromeProps) {
  return (
    <>
      {page.editing ? (
        <input
          className="ails-pdf-overlay-surface absolute left-3 top-12 z-20 w-16 rounded border border-[var(--border)] px-1.5 py-0.5 text-center text-[10px] font-bold text-[var(--foreground)] shadow focus:outline-none focus:ring-1 focus:ring-[var(--brand)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          max={page.count}
          min={1}
          onBlur={() => page.submit()}
          onChange={(event) => page.setDraft(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") page.submit()
            if (event.key === "Escape") page.setEditing(false)
          }}
          ref={pageInputRef}
          type="number"
          value={page.draft}
        />
      ) : (
        <>
          <button
            className="ails-pdf-overlay-surface absolute left-3 top-12 z-10 cursor-pointer select-none rounded border border-[var(--border)] px-1 py-0.5 text-[9px] font-medium text-[var(--foreground)] shadow-sm backdrop-blur-sm"
            onClick={() => {
              page.setDraft(String(page.current))
              page.setEditing(true)
            }}
            type="button"
          >
            {page.label}
          </button>
          <button
            className={cn(
              "absolute left-20 top-3 z-10 hidden cursor-pointer select-none rounded px-1.5 py-0.5 text-[10px] font-medium shadow transition-colors",
              floating.active
                ? "bg-[var(--brand)] text-white"
                : "bg-[var(--muted)] text-[var(--foreground)] hover:bg-[var(--interactive-hover)]",
            )}
            onClick={() => floating.toggle()}
            title={t("독립 플로팅 모드 전환")}
            type="button"
          >
            {t("📌 플로팅")}
          </button>
        </>
      )}

      <PdfTextTools textTools={textTools} />

      {page.checkpoint !== null && (
        <div className="pointer-events-none absolute left-3 top-20 z-10 select-none rounded bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-black shadow">
          Checkpoint {page.checkpoint}
        </div>
      )}
      {status.problemsLoading && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)]/90 px-2.5 py-1 text-[10px] font-semibold text-[var(--foreground)] shadow">
          <Loader2 className="animate-spin" size={11} />
          {status.problemsAnalyzing ? t("문제 분석 중") : t("저장된 문제 정보 불러오는 중")}
        </div>
      )}
      {status.problemError && !status.problemsLoading && (
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-30 max-w-[60%] -translate-x-1/2 truncate rounded-full bg-red-950/85 px-2.5 py-1 text-[10px] font-semibold text-red-100 shadow"
          title={status.problemError}
        >
          {t("문제 분석 결과를 불러오지 못했습니다")}
        </div>
      )}
    </>
  )
}
