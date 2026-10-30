import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import { t } from "../../../lib/i18n.ts"
import { SettingsCard, SettingsSwitch } from "./settings-layout.tsx"

export function PdfAppearanceSettings({
  setNotice,
  view,
}: {
  setNotice: (message: string) => void
  view: PdfController["view"]
}) {
  const {
    pdfColorMode,
    pdfOcrTextVisible,
    pdfPageLayout,
    pdfSpreadSide,
    pdfThemeBrightness,
    pdfThemeContrast,
    pdfThemeSharpness,
    pdfThemeTextBrightness,
    presentationPageLayout,
    setPdfColorMode,
    setPdfOcrTextVisible,
    setPdfPageLayout,
    setPdfSpreadSide,
    setPdfThemeBrightness,
    setPdfThemeContrast,
    setPdfThemeSharpness,
    setPdfThemeTextBrightness,
    setPresentationPageLayout,
  } = view

  return (
    <>
      <SettingsCard title={t("PDF 보기")}>
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2" data-pdf-view-settings="true">
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)]">
            {t("페이지 표시")}
            <select
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)]"
              onChange={(event) => {
                const nextLayout = event.target.value === "spread" ? "spread" : "single"
                setPdfPageLayout(nextLayout)
                localStorage.setItem("ails_pdf_page_layout", nextLayout)
                setNotice(nextLayout === "spread" ? t("PDF를 두 페이지로 표시합니다.") : t("PDF를 한 페이지로 표시합니다."))
              }}
              value={pdfPageLayout}
            >
              <option value="single">{t("한 페이지")}</option>
              <option value="spread">{t("두 페이지")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)]">
            {t("두 페이지 순서")}
            <select
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] disabled:opacity-50"
              disabled={pdfPageLayout !== "spread"}
              onChange={(event) => {
                const nextSide = event.target.value === "odd-left" ? "odd-left" : "even-left"
                setPdfSpreadSide(nextSide)
                localStorage.setItem("ails_pdf_spread_side", nextSide)
                setNotice(nextSide === "even-left" ? t("짝수 페이지를 왼쪽에 배치합니다.") : t("홀수 페이지를 왼쪽에 배치합니다."))
              }}
              value={pdfSpreadSide}
            >
              <option value="even-left">{t("짝수 왼쪽 · 홀수 오른쪽")}</option>
              <option value="odd-left">{t("홀수 왼쪽 · 짝수 오른쪽")}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)] sm:col-span-2">
            {t("PDF 색상")}
            <select
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)]"
              onChange={(event) => {
                const nextMode = event.target.value === "theme" ? "theme" : "original"
                setPdfColorMode(nextMode)
                localStorage.setItem("ails_pdf_color_mode", nextMode)
                setNotice(nextMode === "theme" ? t("PDF 색상을 앱 테마에 맞춥니다.") : t("PDF 원본 색상을 유지합니다."))
              }}
              value={pdfColorMode}
            >
              <option value="original">{t("원본 색상")}</option>
              <option value="theme">{t("앱 테마에 맞춤")}</option>
            </select>
            <span className="leading-4">{t("테마에 맞춤은 라이트·다크 모드에 따라 PDF 배경과 글자 명암을 앱 작업영역에 맞춥니다.")}</span>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)] sm:col-span-2">
            <span className="flex items-center justify-between">
              {t("다크 모드 대비")}<span className="tabular-nums text-[var(--foreground)]">{pdfThemeContrast.toFixed(2)}</span>
            </span>
            <input
              aria-label={t("PDF 다크 모드 대비")}
              className="w-full accent-[var(--brand)]"
              max="2"
              min="0.75"
              onChange={(event) => {
                const nextContrast = Number(event.target.value)
                setPdfThemeContrast(nextContrast)
                localStorage.setItem("ails_pdf_theme_contrast", String(nextContrast))
              }}
              step="0.05"
              type="range"
              value={pdfThemeContrast}
            />
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)] sm:col-span-2">
            <span className="flex items-center justify-between">
              {t("다크 모드 글씨 밝기")}<span className="tabular-nums text-[var(--foreground)]">{pdfThemeBrightness.toFixed(2)}</span>
            </span>
            <input
              aria-label={t("PDF 다크 모드 글씨 밝기")}
              className="w-full accent-[var(--brand)]"
              max="1"
              min="0.6"
              onChange={(event) => {
                const nextBrightness = Number(event.target.value)
                setPdfThemeBrightness(nextBrightness)
                localStorage.setItem("ails_pdf_theme_brightness", String(nextBrightness))
              }}
              step="0.05"
              type="range"
              value={pdfThemeBrightness}
            />
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)] sm:col-span-2">
            <span className="flex items-center justify-between">
              {t("다크 모드 선명도")}<span className="tabular-nums text-[var(--foreground)]">{pdfThemeSharpness.toFixed(2)}</span>
            </span>
            <input
              aria-label={t("PDF 다크 모드 선명도")}
              className="w-full accent-[var(--brand)]"
              max="1"
              min="0"
              onChange={(event) => {
                const nextSharpness = Number(event.target.value)
                setPdfThemeSharpness(nextSharpness)
                localStorage.setItem("ails_pdf_theme_sharpness", String(nextSharpness))
              }}
              step="0.05"
              type="range"
              value={pdfThemeSharpness}
            />
            <span className="leading-4">{t("흐릿한 스캔의 글씨 가장자리를 선명하게 보정합니다. 0이면 꺼짐.")}</span>
          </label>
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)] sm:col-span-2">
            <span className="flex items-center justify-between">
              {t("다크 모드 글씨 밝기 보정")}<span className="tabular-nums text-[var(--foreground)]">{pdfThemeTextBrightness.toFixed(2)}</span>
            </span>
            <input
              aria-label={t("PDF 다크 모드 글씨 밝기 보정")}
              className="w-full accent-[var(--brand)]"
              max="1"
              min="0"
              onChange={(event) => {
                const nextTextBrightness = Number(event.target.value)
                setPdfThemeTextBrightness(nextTextBrightness)
                localStorage.setItem("ails_pdf_theme_text_brightness", String(nextTextBrightness))
              }}
              step="0.05"
              type="range"
              value={pdfThemeTextBrightness}
            />
            <span className="leading-4">{t("옅은 글씨를 더 밝게 보정해 PDF 간 글씨 밝기를 비슷하게 맞춥니다. 0이면 꺼짐.")}</span>
          </label>
        </div>
      </SettingsCard>
      <SettingsCard title={t("PPT 보기")}>
        <div className="px-5 py-4" data-presentation-view-settings="true">
          <label className="grid gap-1 text-xs text-[var(--muted-foreground)]">
            {t("페이지 표시")}
            <select
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)]"
              onChange={(event) => {
                const nextLayout = event.target.value === "spread" ? "spread" : "single"
                setPresentationPageLayout(nextLayout)
                localStorage.setItem("ails_presentation_page_layout", nextLayout)
                setNotice(nextLayout === "spread" ? t("PPT를 두 페이지로 표시합니다.") : t("PPT를 한 페이지로 표시합니다."))
              }}
              value={presentationPageLayout}
            >
              <option value="single">{t("한 페이지")}</option>
              <option value="spread">{t("두 페이지")}</option>
            </select>
            <span className="leading-4">{t("PDF로 변환된 PPT/PPTX에만 적용됩니다.")}</span>
          </label>
        </div>
      </SettingsCard>
      <SettingsCard title={t("PDF 오버레이")}>
        <div className="flex items-center justify-between gap-6 border-t border-[var(--border)] px-5 py-4 first:border-t-0">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--foreground)]">{t("OCR 표시")}</div>
            <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">{t("PDF 위에 인식된 글씨와 인식 영역을 겹쳐 표시합니다.")}</p>
          </div>
          <SettingsSwitch
            ariaLabel={t("OCR 표시")}
            checked={pdfOcrTextVisible}
            onCheckedChange={(checked) => {
              setPdfOcrTextVisible(checked)
              localStorage.setItem("ails_pdf_ocr_text_visible", String(checked))
              setNotice(checked ? t("PDF에 인식된 OCR 글씨를 표시합니다.") : t("PDF OCR 글씨 표시를 끕니다."))
            }}
          />
        </div>
      </SettingsCard>
    </>
  )
}
