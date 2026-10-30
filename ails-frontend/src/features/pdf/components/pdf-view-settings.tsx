import { t } from "../../../lib/i18n.ts"
import { normalizePdfViewZoom, PDF_VIEW_ZOOM_MIN, PDF_VIEW_ZOOM_MAX, PDF_VIEW_ZOOM_STEP } from "../../../lib/pdf-view-layout.ts"
import type { PdfController } from "../hooks/use-pdf-controller.ts"

const selectClass = "h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] disabled:opacity-40"

export function PdfViewSettings({ view, presentation = false, singlePageOnly = false }: { view: PdfController["view"]; presentation?: boolean; singlePageOnly?: boolean }) {
  const layout = singlePageOnly ? "single" : presentation ? view.presentationPageLayout : view.pdfPageLayout
  const { pdfViewZoomCommitTimerRef, pdfViewZoomRef, setPdfViewZoom } = view
  function setZoom(value: number) {
    const zoom = normalizePdfViewZoom(value)
    window.clearTimeout(pdfViewZoomCommitTimerRef.current ?? undefined)
    pdfViewZoomCommitTimerRef.current = null
    pdfViewZoomRef.current = zoom
    setPdfViewZoom(zoom)
    localStorage.setItem("ails_pdf_view_zoom", String(zoom))
  }
  const adjustments = [
    { label: t("대비"), value: view.pdfThemeContrast, min: 0.75, max: 2, key: "ails_pdf_theme_contrast", set: view.setPdfThemeContrast },
    { label: t("글씨 밝기"), value: view.pdfThemeBrightness, min: 0.6, max: 1, key: "ails_pdf_theme_brightness", set: view.setPdfThemeBrightness },
  ]
  return <div className="space-y-4 text-xs" data-ails-pdf-view-settings="true">
    <label className="grid gap-1.5">{t("페이지 표시")}
      <select className={selectClass} value={layout} disabled={singlePageOnly} onChange={(event) => {
        const next = event.target.value === "spread" ? "spread" : "single"
        if (presentation) view.setPresentationPageLayout(next)
        else view.setPdfPageLayout(next)
        localStorage.setItem(presentation ? "ails_presentation_page_layout" : "ails_pdf_page_layout", next)
      }}><option value="single">{t("한 페이지")}</option><option value="spread">{t("두 페이지")}</option></select>
    </label>
    <label className="grid gap-1.5">{t("두 페이지 순서")}
      <select className={selectClass} value={view.pdfSpreadSide} disabled={layout !== "spread"} onChange={(event) => {
        const next = event.target.value === "odd-left" ? "odd-left" : "even-left"
        view.setPdfSpreadSide(next)
        localStorage.setItem("ails_pdf_spread_side", next)
      }}><option value="even-left">{t("짝수 왼쪽 · 홀수 오른쪽")}</option><option value="odd-left">{t("홀수 왼쪽 · 짝수 오른쪽")}</option></select>
    </label>
    <label className="grid gap-1.5">
      <span className="flex items-center justify-between">{t("확대율")}<span className="tabular-nums">{Math.round(view.pdfViewZoom * 100)}%</span></span>
      <input aria-label={t("PDF 확대율")} type="range" min={PDF_VIEW_ZOOM_MIN} max={PDF_VIEW_ZOOM_MAX} step={PDF_VIEW_ZOOM_STEP} value={view.pdfViewZoom} className="w-full accent-[var(--brand)]" onChange={(event) => setZoom(Number(event.target.value))} />
      <button type="button" className="justify-self-start rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--interactive-hover)]" onClick={() => setZoom(1)}>{t("기본 크기로 맞춤")}</button>
    </label>
    <label className="grid gap-1.5 border-t border-[var(--border)] pt-3">{t("PDF 색상")}
      <select className={selectClass} value={view.pdfColorMode} onChange={(event) => {
        const next = event.target.value === "theme" ? "theme" : "original"
        view.setPdfColorMode(next)
        localStorage.setItem("ails_pdf_color_mode", next)
      }}><option value="original">{t("원본 색상")}</option><option value="theme">{t("앱 테마에 맞춤")}</option></select>
    </label>
    <fieldset disabled={view.pdfColorMode !== "theme"} className="space-y-3 disabled:opacity-40">
      <legend className="mb-2 text-[var(--muted-foreground)]">{t("다크 모드 화면 보정")}</legend>
      {adjustments.map(({ label, value, min, max, key, set }) => <label key={key} className="grid gap-1">
        <span className="flex items-center justify-between">{label}<span className="tabular-nums">{value.toFixed(2)}</span></span>
        <input aria-label={`PDF ${label}`} type="range" min={min} max={max} step="0.05" value={value} className="w-full accent-[var(--brand)]" onChange={(event) => { const next = Number(event.target.value); set(next); localStorage.setItem(key, String(next)) }} />
      </label>)}
    </fieldset>
    <label className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">{t("OCR 표시")}
      <input type="checkbox" checked={view.pdfOcrTextVisible} className="accent-[var(--brand)]" onChange={(event) => { view.setPdfOcrTextVisible(event.target.checked); localStorage.setItem("ails_pdf_ocr_text_visible", String(event.target.checked)) }} />
    </label>
    <p className="text-[10px] leading-4 text-[var(--muted-foreground)]">{t("보기 설정은 바로 적용되며 다음에 열 때도 유지됩니다.")}</p>
  </div>
}
