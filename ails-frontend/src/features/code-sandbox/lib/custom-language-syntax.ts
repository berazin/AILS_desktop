import { shikiToMonaco } from "@shikijs/monaco"
import { createHighlighter } from "shiki"
import type * as Monaco from "monaco-editor"

import { getLanguageProfileAssets, type LanguageProfile } from "../../../lib/api"


let highlighterPromise: ReturnType<typeof createHighlighter> | null = null
const registeredLanguages = new Set<string>()
const loadedGrammars = new Set<string>()
const pendingGrammars = new Map<string, Promise<void>>()


function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes: ["dark-plus", "light-plus"], langs: [] })
  }
  return highlighterPromise
}


function toRegExp(value: unknown): RegExp | undefined {
  if (typeof value !== "string" || !value) return undefined
  try {
    return new RegExp(value)
  } catch {
    return undefined
  }
}


interface RawLanguageConfiguration extends Record<string, unknown> {
  wordPattern?: unknown
  folding?: { markers?: { start?: unknown; end?: unknown }; [key: string]: unknown }
  indentationRules?: Record<string, unknown>
}

function languageConfiguration(raw: Record<string, unknown>): Monaco.languages.LanguageConfiguration {
  const source: RawLanguageConfiguration = raw
  const result: Record<string, unknown> = {}
  for (const key of ["comments", "brackets", "autoClosingPairs", "surroundingPairs", "colorizedBracketPairs", "autoCloseBefore"]) {
    if (source[key] !== undefined) result[key] = source[key]
  }
  if (Array.isArray(source.onEnterRules)) {
    result.onEnterRules = source.onEnterRules.flatMap((rawRule) => {
      if (!rawRule || typeof rawRule !== "object") return []
      const rule = rawRule as Record<string, unknown>
      const beforeText = toRegExp(rule.beforeText)
      if (!beforeText) return []
      const afterText = toRegExp(rule.afterText)
      const previousLineText = toRegExp(rule.previousLineText)
      return [{
        ...rule,
        beforeText,
        ...(afterText ? { afterText } : {}),
        ...(previousLineText ? { previousLineText } : {}),
      }]
    })
  }
  const wordPattern = toRegExp(source.wordPattern)
  if (wordPattern) result.wordPattern = wordPattern
  if (source.folding?.markers) {
    const start = toRegExp(source.folding.markers.start)
    const end = toRegExp(source.folding.markers.end)
    result.folding = {
      ...source.folding,
      ...(start && end ? { markers: { start, end } } : { markers: undefined }),
    }
  }
  if (source.indentationRules) {
    const converted: Record<string, RegExp> = {}
    for (const key of ["increaseIndentPattern", "decreaseIndentPattern", "indentNextLinePattern", "unIndentedLinePattern"]) {
      const pattern = toRegExp(source.indentationRules[key])
      if (pattern) converted[key] = pattern
    }
    if (converted.increaseIndentPattern && converted.decreaseIndentPattern) result.indentationRules = converted
  }
  return result as Monaco.languages.LanguageConfiguration
}


function registerLanguage(monaco: typeof Monaco, profile: LanguageProfile) {
  if (registeredLanguages.has(profile.id)) return
  const exists = monaco.languages.getLanguages().some((language: { id: string }) => language.id === profile.id)
  if (!exists) {
    monaco.languages.register({
      id: profile.id,
      aliases: [profile.label, profile.id],
      extensions: profile.extensions.map((extension) => `.${extension}`),
    })
  }
  registeredLanguages.add(profile.id)
}


async function loadProfileGrammar(monaco: typeof Monaco, profile: LanguageProfile) {
  registerLanguage(monaco, profile)
  if (!profile.syntax || loadedGrammars.has(profile.id)) return
  const active = pendingGrammars.get(profile.id)
  if (active) return active
  const pending = (async () => {
    const assets = await getLanguageProfileAssets(profile.id)
    if (assets.configuration) {
      monaco.languages.setLanguageConfiguration(profile.id, languageConfiguration(assets.configuration))
    }
    if (!assets.grammar) return
    const highlighter = await getHighlighter()
    await highlighter.loadLanguage({
      name: profile.id,
      aliases: [profile.label, profile.id],
      scopeName: assets.scope_name || `source.${profile.id}`,
      grammar: assets.grammar,
    } as never)
    shikiToMonaco(highlighter, monaco)
    loadedGrammars.add(profile.id)
  })().finally(() => pendingGrammars.delete(profile.id))
  pendingGrammars.set(profile.id, pending)
  return pending
}


export async function syncCustomLanguageSyntax(monaco: typeof Monaco, profiles: LanguageProfile[]) {
  if (!monaco) return
  profiles.forEach((profile) => registerLanguage(monaco, profile))
  await Promise.allSettled(profiles.map((profile) => loadProfileGrammar(monaco, profile)))
}


export function customSyntaxTheme(theme?: string) {
  return theme === "dark" ? "dark-plus" : "light-plus"
}
