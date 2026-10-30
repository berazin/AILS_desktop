import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import { ACCENT_PRESETS, FULLSCREEN_ON_MAXIMIZE_KEY, type AppearanceController } from "./use-appearance-controller.ts"
import type { ModelSettingsController } from "./use-model-settings-controller.ts"
import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import type { SettingsController, SettingsSnapshot } from "./use-settings-controller.ts"
import { getDefaultConfig, saveConfig, type AILSConfig, type AILSOptions } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { reconcileSavedConfig, settingsValuesEqual, SettingsAutoSave, type SettingsSaveState } from "../lib/settings-autosave.ts"

export type { WorkspaceSurface }


const PDF_OCR_TEXT_VISIBLE_KEY = "ails_pdf_ocr_text_visible"
const PDF_PAGE_LAYOUT_KEY = "ails_pdf_page_layout"
const PRESENTATION_PAGE_LAYOUT_KEY = "ails_presentation_page_layout"
const PDF_SPREAD_SIDE_KEY = "ails_pdf_spread_side"
const PDF_COLOR_MODE_KEY = "ails_pdf_color_mode"
const PDF_THEME_BRIGHTNESS_KEY = "ails_pdf_theme_brightness"
const PDF_THEME_SHARPNESS_KEY = "ails_pdf_theme_sharpness"
const PDF_THEME_TEXT_BRIGHTNESS_KEY = "ails_pdf_theme_text_brightness"
const PDF_THEME_CONTRAST_KEY = "ails_pdf_theme_contrast"

// These settings change either the material tree or document preparation inputs.
const MATERIAL_REFRESH_CONFIG_KEYS = [
  "md_save_path", "current_grade", "current_semester",
  "background_document_embedding", "background_document_ocr", "background_document_ocr_non_ails",
  "background_document_ocr_excluded_paths", "background_document_spacing", "background_document_spacing_non_ails",
  "pdf_ocr_model_variant",
] as const


type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
  onError?: (error: unknown) => void,
) => Promise<void>

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useSettingsWorkflows({
  appearance,
  developerToolsEnabled,
  modelSettings,
  normalizeConfig,
  onPrepareAccount,
  onRefreshApp,
  onRefreshMaterials,
  options,
  pdfView,
  runInteraction,
  setDebugTraceWindowOpen,
  setNotice,
  setWorkspaceSurface,
  settings,
  workspaceSurface,
}: {
  appearance: AppearanceController
  developerToolsEnabled: boolean
  modelSettings: ModelSettingsController
  normalizeConfig: (config: AILSConfig, providerOptions?: readonly string[]) => AILSConfig
  onPrepareAccount: (config: AILSConfig) => void
  onRefreshApp: () => Promise<void>
  onRefreshMaterials: () => Promise<void>
  options: AILSOptions | null
  pdfView: PdfController["view"]
  runInteraction: RunInteraction
  setDebugTraceWindowOpen: Dispatch<SetStateAction<boolean>>
  setNotice: (message: string) => void
  setWorkspaceSurface: Dispatch<SetStateAction<WorkspaceSurface>>
  settings: SettingsController
  workspaceSurface: WorkspaceSurface
}) {
  const returnSurfaceRef = useRef<Exclude<WorkspaceSurface, "settings">>("dashboard")
  const [autoSaveState, setAutoSaveState] = useState<SettingsSaveState>("saved")
  const hadSaveErrorRef = useRef(false)

  function captureSettingsSnapshot(config: AILSConfig): SettingsSnapshot {
    return {
      config: { ...config },
      theme: appearance.theme ?? "system",
      accent: appearance.accent,
      fullscreenOnMaximize: appearance.fullscreenOnMaximize,
      pdfOcrTextVisible: pdfView.pdfOcrTextVisible,
      pdfPageLayout: pdfView.pdfPageLayout,
      presentationPageLayout: pdfView.presentationPageLayout,
      pdfSpreadSide: pdfView.pdfSpreadSide,
      pdfColorMode: pdfView.pdfColorMode,
      pdfThemeContrast: pdfView.pdfThemeContrast,
      pdfThemeBrightness: pdfView.pdfThemeBrightness,
      pdfThemeSharpness: pdfView.pdfThemeSharpness,
      pdfThemeTextBrightness: pdfView.pdfThemeTextBrightness,
      debugTraceWindowOpen: Boolean(config.debug_trace_enabled),
    }
  }

  function persistSettingsSnapshot(snapshot: SettingsSnapshot) {
    localStorage.setItem("ails-accent", snapshot.accent)
    localStorage.setItem(FULLSCREEN_ON_MAXIMIZE_KEY, String(snapshot.fullscreenOnMaximize))
    localStorage.setItem(PDF_OCR_TEXT_VISIBLE_KEY, String(snapshot.pdfOcrTextVisible))
    localStorage.setItem(PDF_PAGE_LAYOUT_KEY, snapshot.pdfPageLayout)
    localStorage.setItem(PRESENTATION_PAGE_LAYOUT_KEY, snapshot.presentationPageLayout)
    localStorage.setItem(PDF_SPREAD_SIDE_KEY, snapshot.pdfSpreadSide)
    localStorage.setItem(PDF_COLOR_MODE_KEY, snapshot.pdfColorMode)
    localStorage.setItem(PDF_THEME_CONTRAST_KEY, String(snapshot.pdfThemeContrast))
    localStorage.setItem(PDF_THEME_BRIGHTNESS_KEY, String(snapshot.pdfThemeBrightness))
    localStorage.setItem(PDF_THEME_SHARPNESS_KEY, String(snapshot.pdfThemeSharpness))
    localStorage.setItem(PDF_THEME_TEXT_BRIGHTNESS_KEY, String(snapshot.pdfThemeTextBrightness))
  }

  function applySettingsSnapshot(snapshot: SettingsSnapshot, persist: boolean) {
    settings.setConfig({ ...snapshot.config })
    appearance.setTheme(snapshot.theme)
    appearance.setAccent(snapshot.accent)
    appearance.setFullscreenOnMaximize(snapshot.fullscreenOnMaximize)
    pdfView.setPdfOcrTextVisible(snapshot.pdfOcrTextVisible)
    pdfView.setPdfPageLayout(snapshot.pdfPageLayout)
    pdfView.setPresentationPageLayout(snapshot.presentationPageLayout)
    pdfView.setPdfSpreadSide(snapshot.pdfSpreadSide)
    pdfView.setPdfColorMode(snapshot.pdfColorMode)
    pdfView.setPdfThemeContrast(snapshot.pdfThemeContrast)
    pdfView.setPdfThemeBrightness(snapshot.pdfThemeBrightness)
    pdfView.setPdfThemeSharpness(snapshot.pdfThemeSharpness)
    pdfView.setPdfThemeTextBrightness(snapshot.pdfThemeTextBrightness)
    setDebugTraceWindowOpen(snapshot.debugTraceWindowOpen)
    if (persist) persistSettingsSnapshot(snapshot)
  }

  const persistAutomatically = useEventCallback(async (snapshot: SettingsSnapshot, previous: SettingsSnapshot) => {
    if (settingsValuesEqual(snapshot.config, previous.config)) return snapshot
    const { config } = await saveConfig(snapshot.config)
    return { ...snapshot, config: normalizeConfig(config, options?.stt_provider_options) }
  })
  const acceptSaved = useEventCallback((saved: SettingsSnapshot, submitted: SettingsSnapshot) => {
    persistSettingsSnapshot(saved)
    settings.setSnapshot(saved)
    settings.setConfig((current) => reconcileSavedConfig(submitted.config, saved.config, current))
  })
  const refreshAfterSave = useEventCallback((saved: SettingsSnapshot, previous: SettingsSnapshot) => {
    if (settingsValuesEqual(previous.config, saved.config)) return
    void onRefreshApp().catch((error) => {
      setNotice(t("설정은 저장했지만 앱 상태를 갱신하지 못했습니다: {p0}", { p0: errorMessage(error) }))
    })
    if (MATERIAL_REFRESH_CONFIG_KEYS.some((key) => !settingsValuesEqual(previous.config[key], saved.config[key]))) {
      void onRefreshMaterials().catch((error) => {
        setNotice(t("강의자료를 불러오지 못했습니다: {p0}", { p0: errorMessage(error) }))
      })
    }
  })
  const updateSaveState = useEventCallback((state: SettingsSaveState, pending: boolean) => {
    settings.setConfigSavePending(pending)
    setAutoSaveState(state)
    if (state === "saved" && hadSaveErrorRef.current) {
      hadSaveErrorRef.current = false
      setNotice(t("변경사항을 자동 저장했습니다."))
    }
  })
  const reportSaveError = useEventCallback((error: unknown) => {
    hadSaveErrorRef.current = true
    setNotice(t("설정을 자동 저장하지 못했습니다. 변경사항은 유지되며 설정을 다시 열거나 변경하면 저장을 재시도합니다: {p0}", { p0: errorMessage(error) }))
  })
  const autoSaveRef = useRef<SettingsAutoSave | null>(null)
  function getAutoSave() {
    if (!autoSaveRef.current) autoSaveRef.current = new SettingsAutoSave({
      save: persistAutomatically, onSaved: acceptSaved, onSettled: refreshAfterSave,
      onState: updateSaveState, onError: reportSaveError,
    })
    return autoSaveRef.current
  }
  const currentSnapshot = settings.open
    ? captureSettingsSnapshot(normalizeConfig(settings.config, options?.stt_provider_options))
    : null
  useEffect(() => {
    if (currentSnapshot) getAutoSave().update(currentSnapshot)
  })
  useEffect(() => () => {
    autoSaveRef.current?.dispose()
    autoSaveRef.current = null
  }, [])

  function close(restoreSurface = true) {
    if (currentSnapshot) getAutoSave().update(currentSnapshot)
    void getAutoSave().flush()
    settings.setLmsPasswordDraft("")
    settings.setPythonExecutableValidation(null)
    settings.setOpen(false)
    if (restoreSurface) setWorkspaceSurface(returnSurfaceRef.current)
  }

  function open() {
    if (settings.open) {
      setWorkspaceSurface("settings")
      if (settings.configSavePendingRef.current) void getAutoSave().flush()
      return
    }
    const normalizedConfig = normalizeConfig(settings.config, options?.stt_provider_options)
    if (workspaceSurface !== "settings") returnSurfaceRef.current = workspaceSurface
    const snapshot = captureSettingsSnapshot(normalizedConfig)
    getAutoSave().begin(snapshot)
    if (!settings.configSavePendingRef.current) settings.setSnapshot(snapshot)
    settings.setConfig(normalizedConfig)
    settings.setLmsPasswordDraft("")
    settings.setOpen(true)
    if (settings.configSavePendingRef.current) void getAutoSave().flush()
    setWorkspaceSurface("settings")
    onPrepareAccount(normalizedConfig)
    if (developerToolsEnabled && Boolean(normalizedConfig.debug_trace_enabled)) {
      setDebugTraceWindowOpen(true)
    }

    void modelSettings.loadOptions()
      .then((nextModelOptions) => {
        const errors = Object.values(nextModelOptions.errors ?? {})
        if (errors.length) setNotice(t("모델 목록 일부를 불러오지 못했습니다: {p0}", { p0: errors[0] }))
      })
      .catch((error) => {
        setNotice(t("모델 목록을 불러오지 못했습니다: {p0}", { p0: errorMessage(error) }))
      })
  }

  async function save() {
    if (currentSnapshot) getAutoSave().update(currentSnapshot)
    return getAutoSave().flush()
  }

  async function resetDefaults() {
    await runInteraction("config-defaults", t("기본 설정 로드"), async () => {
      const { config } = await getDefaultConfig()
      const normalizedConfig = normalizeConfig(config, options?.stt_provider_options)
      applySettingsSnapshot({
        config: normalizedConfig,
        theme: "system",
        accent: ACCENT_PRESETS[0],
        fullscreenOnMaximize: false,
        pdfOcrTextVisible: false,
        pdfPageLayout: "single",
        presentationPageLayout: "single",
        pdfSpreadSide: "even-left",
        pdfColorMode: "theme",
        pdfThemeContrast: 1,
        pdfThemeBrightness: 0.8,
        pdfThemeSharpness: 0,
        pdfThemeTextBrightness: 0,
        debugTraceWindowOpen: false,
      }, false)
      settings.setLmsPasswordDraft("")
      settings.setPythonExecutableValidation(null)
      return t("기본 설정을 적용했습니다. 변경사항은 자동 저장됩니다.")
    })
  }

  return { autoSaveState, close, open, resetDefaults, save }
}

export type SettingsWorkflows = ReturnType<typeof useSettingsWorkflows>
