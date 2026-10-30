import { Moon, Sun } from "lucide-react"

import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import {
  ACCENT_PRESETS,
  type AppearanceController,
} from "../hooks/use-appearance-controller.ts"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { PdfAppearanceSettings } from "./pdf-appearance-settings.tsx"
import { WindowSettingsCard } from "./window-settings-card.tsx"
import { SettingsCard, SettingsRow } from "./settings-layout.tsx"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"

export function AppearanceSettingsSection({
  active,
  appearance,
  pdfView,
  setNotice,
}: {
  active: boolean
  appearance: AppearanceController
  pdfView: PdfController["view"]
  setNotice: (message: string) => void
}) {
  const {
    accent,
    accentColorInputRef,
    flushAccentPreview,
    handleAccentPreview,
    setTheme,
    theme,
    updateAccent,
  } = appearance

  return (
    <section className="grid gap-6" hidden={!active} id="settings-appearance">
      <SettingsCard description={t("앱 테마와 강조색을 선택합니다.")} title={t("테마")}>
        <SettingsRow
          control={(
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                onClick={() => {
                  setTheme("system")
                  setNotice(t("시스템 테마를 적용했습니다."))
                }}
                size="sm"
                variant={theme === "system" ? "default" : "outline"}
              >
                {t("시스템")}
              </Button>
              <Button
                onClick={() => {
                  setTheme("light")
                  setNotice(t("라이트 테마를 적용했습니다."))
                }}
                size="sm"
                variant={theme === "light" ? "default" : "outline"}
              >
                <Sun size={14} /> {t("라이트")}
              </Button>
              <Button
                onClick={() => {
                  setTheme("dark")
                  setNotice(t("다크 테마를 적용했습니다."))
                }}
                size="sm"
                variant={theme === "dark" ? "default" : "outline"}
              >
                <Moon size={14} /> {t("다크")}
              </Button>
            </div>
          )}
          label={t("앱 테마")}
        />
        <SettingsRow
          control={(
            <div className="flex flex-wrap items-center justify-end gap-2">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  aria-label={t("{p0} 테마 선택", { p0: preset })}
                  className={cn(
                    "h-7 w-7 rounded-full border border-[var(--border)] transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                    accent === preset && "ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--panel)]",
                  )}
                  data-ails-color-button="true"
                  key={preset}
                  onClick={() => updateAccent(preset)}
                  style={{ backgroundColor: preset }}
                  type="button"
                />
              ))}
              <Input
                aria-label={t("커스텀 테마 색상")}
                className="h-8 w-12 p-1"
                defaultValue={accent}
                onBlur={flushAccentPreview}
                onInput={handleAccentPreview}
                ref={accentColorInputRef}
                type="color"
              />
            </div>
          )}
          label={t("강조색")}
        />
      </SettingsCard>
      <WindowSettingsCard fullscreenOnMaximize={appearance.fullscreenOnMaximize}
        setFullscreenOnMaximize={appearance.setFullscreenOnMaximize} />
      <PdfAppearanceSettings setNotice={setNotice} view={pdfView} />
    </section>
  )
}
