import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from "react"
import { useTheme } from "next-themes"

import { t } from "../../../lib/i18n.ts"

export const ACCENT_PRESETS = ["#ff5c33", "#2563eb", "#16a34a", "#9333ea", "#0f766e"]
export const FULLSCREEN_ON_MAXIMIZE_KEY = "ails_fullscreen_on_maximize"

export function useAppearanceController({ setNotice }: { setNotice: (message: string) => void }) {
  const { resolvedTheme, setTheme, theme } = useTheme()
  const [accent, setAccent] = useState(() => localStorage.getItem("ails-accent") ?? ACCENT_PRESETS[0])
  const [fullscreenOnMaximize, setFullscreenOnMaximize] = useState(
    () => localStorage.getItem(FULLSCREEN_ON_MAXIMIZE_KEY) === "true",
  )
  const appThemeRootRef = useRef<HTMLDivElement | null>(null)
  const accentColorInputRef = useRef<HTMLInputElement | null>(null)
  const accentCommitTimerRef = useRef<number | null>(null)
  const pendingAccentRef = useRef(accent)

  useEffect(() => {
    const input = accentColorInputRef.current
    if (input && input.value !== accent) input.value = accent
  }, [accent])

  function updateAccent(nextAccent: string) {
    if (accentCommitTimerRef.current !== null) {
      window.clearTimeout(accentCommitTimerRef.current)
      accentCommitTimerRef.current = null
    }
    pendingAccentRef.current = nextAccent
    appThemeRootRef.current?.style.setProperty("--brand", nextAccent)
    appThemeRootRef.current?.style.setProperty("--brand-soft", `${nextAccent}1f`)
    if (accentColorInputRef.current && accentColorInputRef.current.value !== nextAccent) {
      accentColorInputRef.current.value = nextAccent
    }
    setAccent(nextAccent)
    localStorage.setItem("ails-accent", nextAccent)
    setNotice(t("테마 색상을 변경했습니다."))
  }

  function scheduleAccentCommit(nextAccent: string) {
    pendingAccentRef.current = nextAccent
    if (accentCommitTimerRef.current !== null) window.clearTimeout(accentCommitTimerRef.current)
    accentCommitTimerRef.current = window.setTimeout(() => {
      accentCommitTimerRef.current = null
      updateAccent(pendingAccentRef.current)
    }, 300)
  }

  function handleAccentPreview(event: FormEvent<HTMLInputElement>) {
    const nextAccent = event.currentTarget.value
    appThemeRootRef.current?.style.setProperty("--brand", nextAccent)
    appThemeRootRef.current?.style.setProperty("--brand-soft", `${nextAccent}1f`)
    scheduleAccentCommit(nextAccent)
  }

  function flushAccentPreview(event: FocusEvent<HTMLInputElement>) {
    updateAccent(event.currentTarget.value)
  }

  return {
    accent,
    accentColorInputRef,
    appThemeRootRef,
    flushAccentPreview,
    handleAccentPreview,
    fullscreenOnMaximize,
    resolvedTheme,
    setAccent,
    setFullscreenOnMaximize,
    setTheme,
    theme,
    updateAccent,
  }
}

export type AppearanceController = ReturnType<typeof useAppearanceController>
