import { Eraser, MousePointer2, Palette, Redo2, Undo2, X } from "lucide-react"
import type { RefObject } from "react"

import type { PdfAnnotationMode, PdfAnnotationSettings } from "./pdf-annotation-layer.tsx"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"

type PdfAnnotationPaletteProps = {
  actions: {
    redo: () => void
    retrySaves: () => void
    setMode: (mode: PdfAnnotationMode) => void
    undo: () => void
    updateSettings: (patch: Partial<PdfAnnotationSettings>) => void
  }
  containerRef: RefObject<HTMLDivElement | null>
  model: {
    annotationCount: number
    error: string
    mode: PdfAnnotationMode
    pendingCount: number
    redoCount: number
    settings: PdfAnnotationSettings
    undoCount: number
  }
  onOpenChange: (open: boolean) => void
  open: boolean
  showTrigger?: boolean
}

export function PdfAnnotationPalette({ actions, containerRef, model, onOpenChange, open, showTrigger = true }: PdfAnnotationPaletteProps) {
  return (
    <div className="relative" ref={containerRef}>
      {showTrigger && <button
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-0.5 text-xs font-normal transition-all active:scale-95",
          model.mode === "default"
            ? "text-[var(--muted-foreground)] hover:bg-[var(--brand)] hover:text-white"
            : "bg-[var(--brand)] text-white",
        )}
        onClick={() => onOpenChange(!open)}
        title={t("PDF 필기와 설명 설정")}
        type="button"
      >
        <Palette size={12} />
        {t("팔레트")}
      </button>}
      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-[180] max-h-[calc(100vh-48px)] w-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 text-[var(--foreground)] shadow-2xl"
          data-ails-window="true"
          data-ails-document-popover="true"
        >
          <div className="mb-2 flex items-center justify-between text-xs font-semibold">{t("PDF 주석")}<button type="button" data-pdf-palette-close aria-label={t("팔레트 닫기")} className="rounded p-1 hover:bg-[var(--interactive-hover)]" onClick={() => onOpenChange(false)}><X size={14} /></button></div>
          <div className="grid grid-cols-2 gap-1">
            {([
              ["default", t("기본"), MousePointer2],
              ["erase", t("지우기"), Eraser],
            ] as const).map(([mode, label, Icon]) => (
              <button
                aria-pressed={model.mode === mode}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] font-semibold transition-colors",
                  model.mode === mode
                    ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
                )}
                key={mode}
                onClick={() => actions.setMode(mode)}
                type="button"
              >
                <Icon size={15} />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-[var(--muted-foreground)]">
            {t("기본 모드에서 글씨를 드래그하면 선택되고, 빈 공간은 클릭하면 글 입력, 드래그하면 필기입니다. 우클릭으로 이전·다음 페이지를 이동합니다.")}
          </p>

          <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 border-t border-[var(--border)] pt-3 text-[11px]">
            <span className="text-[var(--muted-foreground)]">{t("색상")}</span>
            <div className="flex items-center gap-1.5">
              {["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#111827"].map((color) => (
                <button
                  aria-label={t("주석 색상 {p0}", { p0: color })}
                  className={cn(
                    "h-5 w-5 rounded-full border-2",
                    model.settings.color.toLowerCase() === color ? "border-[var(--foreground)]" : "border-transparent",
                  )}
                  key={color}
                  onClick={() => actions.updateSettings({ color })}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
              <input
                aria-label={t("사용자 지정 주석 색상")}
                className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
                onChange={(event) => actions.updateSettings({ color: event.target.value })}
                type="color"
                value={model.settings.color}
              />
            </div>

            <label className="text-[var(--muted-foreground)]" htmlFor="pdf-annotation-width">{t("펜 굵기")}</label>
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 accent-[var(--brand)]"
                id="pdf-annotation-width"
                max="12"
                min="1"
                onChange={(event) => actions.updateSettings({ strokeWidth: Number(event.target.value) })}
                step="1"
                type="range"
                value={model.settings.strokeWidth}
              />
              <span className="w-7 text-right tabular-nums">{model.settings.strokeWidth}px</span>
            </div>

            <label className="text-[var(--muted-foreground)]" htmlFor="pdf-annotation-font-size">{t("글자 크기")}</label>
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 accent-[var(--brand)]"
                id="pdf-annotation-font-size"
                max="36"
                min="10"
                onChange={(event) => actions.updateSettings({ fontSize: Number(event.target.value) })}
                step="1"
                type="range"
                value={model.settings.fontSize}
              />
              <span className="w-7 text-right tabular-nums">{model.settings.fontSize}px</span>
            </div>

            <span className="text-[var(--muted-foreground)]">{t("도형 교정")}</span>
            <label className="flex items-center gap-2">
              <input
                checked={model.settings.shapeCorrection}
                className="accent-[var(--brand)]"
                onChange={(event) => actions.updateSettings({ shapeCorrection: event.target.checked })}
                type="checkbox"
              />
              {t("직선·원 자동 교정")}
            </label>

            <label className="text-[var(--muted-foreground)]" htmlFor="pdf-annotation-hold">{t("기다림")}</label>
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 accent-[var(--brand)] disabled:opacity-40"
                disabled={!model.settings.shapeCorrection}
                id="pdf-annotation-hold"
                max="1000"
                min="300"
                onChange={(event) => actions.updateSettings({ shapeHoldMs: Number(event.target.value) })}
                step="100"
                type="range"
                value={model.settings.shapeHoldMs}
              />
              <span className="w-8 text-right tabular-nums">{(model.settings.shapeHoldMs / 1000).toFixed(1)}{t("초")}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
            <span className="text-[10px] text-[var(--muted-foreground)]">{t("주석 ")}{model.annotationCount}{t("개")}</span>
            <div className="flex gap-1">
              <button aria-label={t("주석 실행 취소")} className="rounded-md border border-[var(--border)] p-1.5 disabled:opacity-35" disabled={model.undoCount === 0} onClick={actions.undo} title={t("실행 취소")} type="button"><Undo2 size={14} /></button>
              <button aria-label={t("주석 다시 실행")} className="rounded-md border border-[var(--border)] p-1.5 disabled:opacity-35" disabled={model.redoCount === 0} onClick={actions.redo} title={t("다시 실행")} type="button"><Redo2 size={14} /></button>
            </div>
          </div>
          {model.pendingCount > 0 && !model.error && (
            <div className="mt-2 text-[10px] text-[var(--muted-foreground)]">{t("로컬 저장 중...")}</div>
          )}
          {model.error && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[10px] text-red-500">
              <span className="min-w-0 flex-1 truncate" title={model.error}>{t("주석을 저장하지 못했습니다.")}</span>
              <button className="shrink-0 font-semibold underline" onClick={actions.retrySaves} type="button">{t("다시 시도")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
