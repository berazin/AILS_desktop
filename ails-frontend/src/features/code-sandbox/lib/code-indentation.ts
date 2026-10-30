import type * as Monaco from "monaco-editor"


export interface CodeIndentationRules {
  increaseIndentPattern: RegExp
  decreaseIndentPattern: RegExp
}

const BRACE_INDENTATION: CodeIndentationRules = {
  increaseIndentPattern: /^.*\{[^}]*$/,
  decreaseIndentPattern: /^\s*\}/,
}

const PYTHON_INDENTATION: CodeIndentationRules = {
  increaseIndentPattern: /^\s*(?:async\s+)?(?:def|class|for|if|elif|else|while|try|with|finally|except|match|case)\b.*:\s*(?:#.*)?$/,
  decreaseIndentPattern: /^\s*(?:elif|else|except|finally|case)\b/,
}

const LUA_INDENTATION: CodeIndentationRules = {
  increaseIndentPattern: /(?:\b(?:then|do|function)\b[^\n]*|^\s*repeat\s*|\{[^}]*)$/,
  decreaseIndentPattern: /^\s*(?:end|else|elseif|until)\b|^\s*\}/,
}

const SHELL_INDENTATION: CodeIndentationRules = {
  increaseIndentPattern: /(?:\bthen\b|\bdo\b|\{)\s*(?:#.*)?$/,
  decreaseIndentPattern: /^\s*(?:fi|done|esac)\b|^\s*\}/,
}

const SQL_INDENTATION: CodeIndentationRules = {
  increaseIndentPattern: /^\s*(?:BEGIN|CASE)\b(?!.*\bEND\b).*$/i,
  decreaseIndentPattern: /^\s*END\b/i,
}

const BRACE_LANGUAGES = new Set([
  "cpp",
  "csharp",
  "java",
  "javascript",
  "typescript",
  "go",
  "rust",
  "css",
  "json",
])

const configuredMonacoInstances = new WeakSet<object>()

export function indentationRulesForLanguage(language: string): CodeIndentationRules | null {
  if (BRACE_LANGUAGES.has(language)) return BRACE_INDENTATION
  if (language === "python") return PYTHON_INDENTATION
  if (language === "lua") return LUA_INDENTATION
  if (language === "shell") return SHELL_INDENTATION
  if (language === "sql") return SQL_INDENTATION
  return null
}

export function closingBraceOutdentLength(language: string, line: string, tabSize = 4) {
  if (!BRACE_LANGUAGES.has(language)) return 0
  const match = line.match(/^(\s+)\}/)
  if (!match) return 0

  const indentation = match[1]
  if (indentation.endsWith("\t")) return 1
  const trailingSpaces = indentation.match(/ +$/)?.[0].length || 0
  return Math.min(Math.max(1, tabSize), trailingSpaces)
}

export function installCodeIndentation(monaco: typeof Monaco) {
  if (!monaco || configuredMonacoInstances.has(monaco)) return

  const registeredLanguages = new Set(monaco.languages.getLanguages().map((language) => language.id))
  for (const language of registeredLanguages) {
    const indentationRules = indentationRulesForLanguage(language)
    if (!indentationRules) continue
    monaco.languages.setLanguageConfiguration(language, { indentationRules })
  }
  configuredMonacoInstances.add(monaco)
}
