import { useEffect, useRef, useState } from "react"

import {
  getBackgroundWorkStatus,
  getPythonRuntimeStatus,
  openDirectoryDialog,
  openFileDialog,
  validatePythonExecutable,
  type AILSConfig,
  type BackgroundWorkStatus,
  type PythonRuntimeStatus,
} from "../../../lib/api"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { setUiLanguage, t } from "../../../lib/i18n.ts"
import type { PdfColorMode, PdfPageLayout, PdfSpreadSide } from "../../../lib/pdf-view-layout.ts"

export interface SettingsSnapshot {
  config: AILSConfig
  theme: string
  accent: string
  fullscreenOnMaximize: boolean
  pdfOcrTextVisible: boolean
  pdfPageLayout: PdfPageLayout
  presentationPageLayout: PdfPageLayout
  pdfSpreadSide: PdfSpreadSide
  pdfColorMode: PdfColorMode
  pdfThemeContrast: number
  pdfThemeBrightness: number
  pdfThemeSharpness: number
  pdfThemeTextBrightness: number
  debugTraceWindowOpen: boolean
}

export function useSettingsController() {
  const [open, setOpen] = useState(false)
  const [config, setConfig] = useState<AILSConfig>({})
  const [i18nVersion, setI18nVersion] = useState(0)
  const [lmsPasswordDraft, setLmsPasswordDraft] = useState("")
  const [backgroundWorkStatus, setBackgroundWorkStatus] = useState<BackgroundWorkStatus | null>(null)
  const [pythonRuntime, setPythonRuntime] = useState<PythonRuntimeStatus | null>(null)
  const [pythonExecutableValidation, setPythonExecutableValidation] = useState<{
    path: string
    ok: boolean
    version: string
    error: string
  } | null>(null)
  const pythonValidationTimerRef = useRef<number | null>(null)
  const snapshotRef = useRef<SettingsSnapshot | null>(null)
  const configSavePendingRef = useRef(false)

  useEffect(() => {
    setUiLanguage(config.language)
    setI18nVersion((version) => version + 1)
  }, [config.language])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getPythonRuntimeStatus()
      .then((status) => {
        if (!cancelled) setPythonRuntime(status)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open])

  async function pickSaveDirectory() {
    const result = await openDirectoryDialog({
      title: t("정리본 저장 폴더 선택"),
      initial_dir: String(config.md_save_path ?? ""),
    })
    if (result.path) {
      setConfig((current) => ({ ...current, md_save_path: result.path }))
      return t("정리본 저장 폴더를 선택했습니다.")
    }
    return t("선택한 폴더가 없습니다.")
  }

  async function pickPythonExecutable() {
    const desktop = getAppDesktopApi()
    if (desktop?.pick_python_executable) {
      const nativePath = await desktop.pick_python_executable().catch(() => "")
      if (nativePath) {
        setConfig((current) => ({ ...current, python_kernel_executable: nativePath }))
        setPythonExecutableValidation(null)
        return t("파이썬 실행 파일을 선택했습니다.")
      }
      return t("선택한 파이썬 실행 파일이 없습니다.")
    }
    const currentPath = String(config.python_kernel_executable ?? "").trim()
    const currentDir = currentPath.replace(/[\\/][^\\/]*$/, "")
    const result = await openFileDialog({
      kind: "python",
      title: "Python executable select",
      initial_dir: currentDir || String(config.md_save_path ?? ""),
    })
    if (result.path) {
      setConfig((current) => ({ ...current, python_kernel_executable: result.path }))
      setPythonExecutableValidation(null)
      return t("파이썬 실행 파일을 선택했습니다.")
    }
    return t("선택한 파이썬 실행 파일이 없습니다.")
  }

  async function refreshPythonRuntime() {
    const status = await getPythonRuntimeStatus()
    setPythonRuntime(status)
    return t("파이썬 {p0}개를 감지했습니다.", { p0: status.installations.length })
  }

  function queuePythonExecutableValidation(value: string) {
    if (pythonValidationTimerRef.current) window.clearTimeout(pythonValidationTimerRef.current)
    const trimmed = value.trim()
    if (!trimmed) {
      setPythonExecutableValidation(null)
      return
    }
    pythonValidationTimerRef.current = window.setTimeout(() => {
      void validatePythonExecutable(trimmed)
        .then((result) => setPythonExecutableValidation(result))
        .catch(() => setPythonExecutableValidation(null))
    }, 500)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = () => {
      void getBackgroundWorkStatus()
        .then((payload) => {
          if (!cancelled) setBackgroundWorkStatus(payload.background_work)
        })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open])

  return {
    backgroundWorkStatus,
    config,
    configSavePendingRef,
    setConfigSavePending: (pending: boolean) => { configSavePendingRef.current = pending },
    getSnapshot: () => snapshotRef.current,
    i18nVersion,
    lmsPasswordDraft,
    open,
    pythonExecutableValidation,
    pythonRuntime,
    pythonValidationTimerRef,
    setConfig,
    setLmsPasswordDraft,
    setOpen,
    setPythonExecutableValidation,
    setPythonRuntime,
    setSnapshot: (snapshot: SettingsSnapshot | null) => {
      snapshotRef.current = snapshot
    },
    snapshotRef,
    runtime: {
      pickPythonExecutable,
      pickSaveDirectory,
      pythonExecutableValidation,
      pythonRuntime,
      queuePythonExecutableValidation,
      refreshPythonRuntime,
      setPythonExecutableValidation,
    },
  }
}

export type SettingsController = ReturnType<typeof useSettingsController>
