import { createContext, useContext } from "react"

// UI i18n for the whole app surface. Dictionaries are keyed by the Korean
// source string, so `t()` falls back to Korean whenever a translation is
// missing — partial coverage can never crash or blank the UI.

export type UiLanguage = "korean" | "english" | "japanese" | "chinese"

export const UI_LANGUAGES: UiLanguage[] = ["korean", "english", "japanese", "chinese"]

function normalizeUiLanguage(value: unknown): UiLanguage {
  const raw = String(value ?? "").trim().toLowerCase()
  if (raw === "english" || raw === "en") return "english"
  if (raw === "japanese" || raw === "ja" || raw === "jp") return "japanese"
  if (raw === "chinese" || raw === "zh") return "chinese"
  return "korean"
}

// Dictionary entries are [english, japanese, chinese]; null/missing falls
// back to the Korean key itself.
export type TranslationEntry = [string | null, string | null, string | null]

const dictionaries: Record<string, TranslationEntry>[] = []

// Generated dictionaries (src/lib/i18n-dict-*.ts) register themselves here.
export function registerDictionary(dict: Record<string, TranslationEntry>): void {
  dictionaries.push(dict)
}

let currentLanguage: UiLanguage = "korean"

export function setUiLanguage(value: unknown): UiLanguage {
  currentLanguage = normalizeUiLanguage(value)
  return currentLanguage
}

export function getUiLanguage(): UiLanguage {
  return currentLanguage
}

const LANGUAGE_INDEX: Record<string, 0 | 1 | 2> = { english: 0, japanese: 1, chinese: 2 }

export function translate(
  key: string,
  vars?: Record<string, unknown>,
  language: UiLanguage = currentLanguage,
): string {
  if (language !== "korean") {
    const index = LANGUAGE_INDEX[language]
    for (const dict of dictionaries) {
      const entry = dict[key]
      const translated = entry ? entry[index] : undefined
      if (translated) {
        key = translated
        break
      }
    }
  }
  if (!vars) return key
  return key.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined || value === null ? match : String(value)
  })
}

export function t(key: string, vars?: Record<string, unknown>): string {
  return translate(key, vars)
}

export const I18nContext = createContext<{ version: number }>({ version: 0 })

export function useI18nVersion(): number {
  return useContext(I18nContext).version
}
