import { t } from "../../../lib/i18n.ts"
import type * as Monaco from "monaco-editor"
import {
  type CodeReviewIssue,
  type CodeReviewRunResult,
  type CodeRunSessionStatus,
  type LanguageProfile,
  type PdfProblem,
  type PdfProblemAnswerType,
  type PdfProblemMultimodalReview,
  type PdfProblemReviewProposal,
  type PdfProblemReviewQueueItem,
  type PdfProblemReviewResolutionContent,
  type PdfProblemReviewSelectionSource,
} from "../../../lib/api"
import {
  CODE_SHORTCUT_DEFINITIONS,
  isCodeKeymapProfile,
  type CodeKeymapProfile,
  type CodeShortcutAction,
  type CodeShortcutOverridesByProfile,
} from "./code-shortcuts.ts"
import { normalizeProjectPath } from "./code-project-browser.ts"
import { pdfProblemAnswerType } from "../../../lib/problem-study.ts"
import { codeLanguageForPath } from './code-file-types.ts'

/* Pure support helpers extracted from src/features/code-sandbox/components/code-sandbox.tsx.
   No React, no component state: localStorage persistence readers/writers,
   window resize/console helpers, sandbox file utilities, and AI issue helpers. */

export const CODE_SANDBOX_KEYMAP_KEY = "ails_sandbox_keymap"
export const CODE_SANDBOX_SHORTCUTS_KEY = "ails_sandbox_shortcuts"
export const CODE_SANDBOX_TEMPLATES_KEY = "ails_sandbox_templates"
export const CODE_SANDBOX_EDITOR_FONT_SIZE_KEY = "ails_sandbox_editor_font_size"
export const CODE_SANDBOX_SIDEBAR_LIST_FONT_SIZE_KEY = "ails_sandbox_sidebar_list_font_size"
export const CODE_SANDBOX_AI_REVIEW_FONT_SIZE_KEY = "ails_sandbox_ai_review_font_size"

export function multimodalReviewProposal(review: PdfProblemMultimodalReview) {
  return (review.proposal ?? review.raw_proposal ?? {}) as Partial<PdfProblemReviewProposal> & Record<string, unknown>
}

export function multimodalReviewChoices(review: PdfProblemMultimodalReview) {
  const choices = multimodalReviewProposal(review).choices
  return Array.isArray(choices) ? choices.map((choice) => String(choice)) : []
}

export function multimodalReviewCode(review: PdfProblemMultimodalReview) {
  const code = multimodalReviewProposal(review).code
  return Array.isArray(code) ? code.map((block) => String(block)) : []
}

export function reviewQueueCandidateContent(
  item: PdfProblemReviewQueueItem,
  source: PdfProblemReviewSelectionSource,
): PdfProblemReviewResolutionContent {
  if (source === "paddleocr") {
    return {
      problem_text: String(item.original.problem_text || ""),
      choices: (item.original.choices ?? []).map(String),
      code: (item.original.code ?? []).map(String),
      code_positions: [...(item.original.code_positions ?? [])],
      answer_type: pdfProblemAnswerType(item.original),
    }
  }
  const review = source === "luna" ? item.primary_review : item.fallback_review
  const proposal = multimodalReviewProposal(review)
  return {
    problem_text: String(proposal.problem_text || item.original.problem_text || ""),
    choices: multimodalReviewChoices(review),
    code: multimodalReviewCode(review),
    code_positions: Array.isArray(proposal.code_positions) ? proposal.code_positions.map(Number) : [],
    answer_type: (proposal.answer_type as PdfProblemAnswerType) || pdfProblemAnswerType(item.original),
  }
}
export const CODE_SANDBOX_SETTINGS_CONTENT_FONT_SIZE_KEY = "ails_sandbox_settings_content_font_size"
export const CODE_SANDBOX_CONSOLE_INPUT_SETTINGS_PREFIX = "ails_sandbox_console_input_file:"
export const CONSOLE_STREAM_CHARACTER_LIMIT = 1_000_000
export const COMPILER_MARKER_OWNER = "ails-compiler"
export const CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE = 5
export const CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE = 10
export const CODE_SANDBOX_CONSOLE_RESIZE_HIT_ZONE = 5

export type ConsoleStatus = "idle" | "starting" | "stopping" | CodeRunSessionStatus
export type WindowResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

export interface ProblemBatchProgress {
  status: "running" | "completed" | "cancelled" | "failed"
  total: number
  completed: number
  correct: number
  incorrect: number
  failed: number
  unresolved?: number
  skipped: number
  currentLabel: string
}

export function codeSandboxResizeDirection(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): WindowResizeDirection | "" {
  const rect = element.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return ""

  const nearCornerLeft = x <= CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE
  const nearCornerRight = x >= rect.width - CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE
  const nearCornerTop = y <= CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE
  const nearCornerBottom = y >= rect.height - CODE_SANDBOX_RESIZE_CORNER_HIT_ZONE
  if (nearCornerTop && nearCornerLeft) return "nw"
  if (nearCornerTop && nearCornerRight) return "ne"
  if (nearCornerBottom && nearCornerLeft) return "sw"
  if (nearCornerBottom && nearCornerRight) return "se"

  if (y <= CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE) return "n"
  if (y >= rect.height - CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE) return "s"
  if (x <= CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE) return "w"
  if (x >= rect.width - CODE_SANDBOX_RESIZE_EDGE_HIT_ZONE) return "e"
  return ""
}

export function codeSandboxResizeCursor(direction: WindowResizeDirection | "") {
  return direction ? `${direction}-resize` : undefined
}

export function isConsoleTopResizeHit(element: HTMLElement, clientY: number) {
  const rect = element.getBoundingClientRect()
  const offsetY = clientY - rect.top
  return offsetY >= 0 && offsetY <= CODE_SANDBOX_CONSOLE_RESIZE_HIT_ZONE
}

export function isTerminalConsoleStatus(status: ConsoleStatus): status is Exclude<CodeRunSessionStatus, "running"> {
  return status === "exited" || status === "stopped" || status === "timed_out" || status === "failed"
}

export function consoleStatusLabel(status: ConsoleStatus, returnCode: number | null) {
  if (status === "starting") return "Starting"
  if (status === "running") return "Running"
  if (status === "stopping") return "Stopping"
  if (status === "exited") return returnCode === null ? "Finished" : `Exited (${returnCode})`
  if (status === "stopped") return "Stopped"
  if (status === "timed_out") return "Timed out"
  if (status === "failed") return "Failed"
  return "Idle"
}

export function consoleErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function appendConsoleTail(current: string, addition: string) {
  if (!addition) return current
  const combined = current + addition
  return combined.length > CONSOLE_STREAM_CHARACTER_LIMIT
    ? combined.slice(-CONSOLE_STREAM_CHARACTER_LIMIT)
    : combined
}

export function sandboxSourceSignature(files: Array<{ name: string; code: string }>) {
  let hash = 2166136261
  for (const file of files) {
    const value = `${file.name}\0${file.code}\0`
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `${files.length}:${(hash >>> 0).toString(16)}`
}

export function createProblemGradingAttemptId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `grading-${globalThis.crypto.randomUUID()}`
  }
  return `grading-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function formatProblemRetryDue(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ""
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(date)
}

export interface PersistedConsoleInputSettings {
  retained: boolean
  input: string
}

export function normalizeConsoleInputScopePart(value: string) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export function consoleInputSettingsScope(baseDir: string, projectName: string, fileName: string) {
  return [
    normalizeConsoleInputScopePart(baseDir),
    normalizeConsoleInputScopePart(normalizeProjectPath(projectName)),
    normalizeConsoleInputScopePart(fileName),
  ] as const
}

export function consoleInputSettingsStorageKey(baseDir: string, projectName: string, fileName: string) {
  return `${CODE_SANDBOX_CONSOLE_INPUT_SETTINGS_PREFIX}${encodeURIComponent(JSON.stringify(
    consoleInputSettingsScope(baseDir, projectName, fileName),
  ))}`
}

export function readPersistedConsoleInputSettings(baseDir: string, projectName: string, fileName: string): PersistedConsoleInputSettings {
  if (!baseDir || !projectName || !fileName) return { retained: false, input: "" }
  try {
    const raw = localStorage.getItem(consoleInputSettingsStorageKey(baseDir, projectName, fileName))
    if (!raw) return { retained: false, input: "" }
    const parsed = JSON.parse(raw) as Partial<PersistedConsoleInputSettings>
    return {
      retained: parsed.retained === true,
      input: typeof parsed.input === "string" ? parsed.input : "",
    }
  } catch {
    return { retained: false, input: "" }
  }
}

export function writePersistedConsoleInputSettings(
  baseDir: string,
  projectName: string,
  fileName: string,
  settings: PersistedConsoleInputSettings,
) {
  if (!baseDir || !projectName || !fileName) return
  try {
    const key = consoleInputSettingsStorageKey(baseDir, projectName, fileName)
    if (!settings.retained && !settings.input) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(settings))
  } catch {
    // The setting still applies to the current window if storage is unavailable.
  }
}

export function movePersistedConsoleInputFileSettings(
  baseDir: string,
  projectName: string,
  oldFileName: string,
  newFileName: string,
) {
  try {
    const oldKey = consoleInputSettingsStorageKey(baseDir, projectName, oldFileName)
    const newKey = consoleInputSettingsStorageKey(baseDir, projectName, newFileName)
    if (oldKey === newKey) return
    const raw = localStorage.getItem(oldKey)
    if (raw !== null) localStorage.setItem(newKey, raw)
    localStorage.removeItem(oldKey)
  } catch {
    // Ignore storage failures; the active in-memory setting remains available.
  }
}

export function parseConsoleInputSettingsKey(key: string) {
  if (!key.startsWith(CODE_SANDBOX_CONSOLE_INPUT_SETTINGS_PREFIX)) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(key.slice(CODE_SANDBOX_CONSOLE_INPUT_SETTINGS_PREFIX.length))) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 3 || parsed.some((part) => typeof part !== "string")) return null
    return parsed as [string, string, string]
  } catch {
    return null
  }
}

export function movePersistedConsoleInputProjectSettings(baseDir: string, oldProjectName: string, newProjectName: string) {
  const normalizedBaseDir = normalizeConsoleInputScopePart(baseDir)
  const normalizedOldProject = normalizeConsoleInputScopePart(normalizeProjectPath(oldProjectName))
  const normalizedNewProject = normalizeConsoleInputScopePart(normalizeProjectPath(newProjectName))
  if (!normalizedOldProject || normalizedOldProject === normalizedNewProject) return
  try {
    const moves: Array<{ oldKey: string; newKey: string; value: string }> = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) continue
      const scope = parseConsoleInputSettingsKey(key)
      if (!scope || scope[0] !== normalizedBaseDir) continue
      if (scope[1] !== normalizedOldProject && !scope[1].startsWith(`${normalizedOldProject}/`)) continue
      const suffix = scope[1].slice(normalizedOldProject.length)
      const nextScope: [string, string, string] = [scope[0], `${normalizedNewProject}${suffix}`, scope[2]]
      const value = localStorage.getItem(key)
      if (value !== null) {
        moves.push({
          oldKey: key,
          newKey: `${CODE_SANDBOX_CONSOLE_INPUT_SETTINGS_PREFIX}${encodeURIComponent(JSON.stringify(nextScope))}`,
          value,
        })
      }
    }
    for (const move of moves) {
      localStorage.setItem(move.newKey, move.value)
      localStorage.removeItem(move.oldKey)
    }
  } catch {
    // Ignore storage failures; project operations should still complete.
  }
}

export function removePersistedConsoleInputProjectSettings(baseDir: string, projectName: string) {
  const normalizedBaseDir = normalizeConsoleInputScopePart(baseDir)
  const normalizedProject = normalizeConsoleInputScopePart(normalizeProjectPath(projectName))
  try {
    const keys: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key) continue
      const scope = parseConsoleInputSettingsKey(key)
      if (!scope || scope[0] !== normalizedBaseDir) continue
      if (scope[1] === normalizedProject || scope[1].startsWith(`${normalizedProject}/`)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function readPersistedKeymapProfile(): CodeKeymapProfile {
  const saved = localStorage.getItem(CODE_SANDBOX_KEYMAP_KEY) || ""
  return isCodeKeymapProfile(saved) ? saved : "visualstudio"
}

export function readPersistedShortcutOverrides(): CodeShortcutOverridesByProfile {
  try {
    const parsed = JSON.parse(localStorage.getItem(CODE_SANDBOX_SHORTCUTS_KEY) || "{}") as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const result: CodeShortcutOverridesByProfile = {}
    for (const profile of ["vscode", "visualstudio", "jetbrains"] as const) {
      const profileValue = (parsed as Record<string, unknown>)[profile]
      if (!profileValue || typeof profileValue !== "object" || Array.isArray(profileValue)) continue
      const overrides: Partial<Record<CodeShortcutAction, string>> = {}
      for (const definition of CODE_SHORTCUT_DEFINITIONS) {
        const shortcut = (profileValue as Record<string, unknown>)[definition.action]
        if (typeof shortcut === "string") overrides[definition.action] = shortcut
      }
      result[profile] = overrides
    }
    return result
  } catch {
    return {}
  }
}

let codeMonacoFallbackThemeRegistered = false

export function ensureCodeMonacoFallbackTheme(monaco: typeof Monaco) {
  if (codeMonacoFallbackThemeRegistered) return
  monaco.editor.defineTheme("dark-plus", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.lineHighlightBorder": "#3f3f46",
      "editorOverviewRuler.border": "#3f3f46",
      "editorWidget.border": "#3f3f46",
      "inputOption.activeBorder": "#52525b",
    },
  })
  monaco.editor.defineTheme("light-plus", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#fbfdff",
      "editor.lineHighlightBorder": "#dbe4ef",
      "editorOverviewRuler.border": "#dbe4ef",
      "editorWidget.border": "#dbe4ef",
      "inputOption.activeBorder": "#64748b",
    },
  })
  codeMonacoFallbackThemeRegistered = true
}

export function readPersistedEditorFontSize() {
  const saved = Number(localStorage.getItem(CODE_SANDBOX_EDITOR_FONT_SIZE_KEY))
  return Number.isFinite(saved) ? Math.min(28, Math.max(9, saved)) : 12
}

export function readPersistedSidebarListFontSize() {
  const saved = Number(localStorage.getItem(CODE_SANDBOX_SIDEBAR_LIST_FONT_SIZE_KEY))
  return Number.isFinite(saved) ? Math.min(18, Math.max(8, saved)) : 10
}

export function readPersistedAiReviewFontSize() {
  const saved = Number(localStorage.getItem(CODE_SANDBOX_AI_REVIEW_FONT_SIZE_KEY))
  return Number.isFinite(saved) ? Math.min(22, Math.max(9, saved)) : 11
}

export function readPersistedSettingsContentFontSize() {
  const saved = Number(localStorage.getItem(CODE_SANDBOX_SETTINGS_CONTENT_FONT_SIZE_KEY))
  return Number.isFinite(saved) ? Math.min(18, Math.max(10, saved)) : 12
}

export function readPersistedTemplate(lang: string): string | null {
  try {
    const rawTemplates = localStorage.getItem(CODE_SANDBOX_TEMPLATES_KEY)
    if (rawTemplates) {
      const templates = JSON.parse(rawTemplates) as Record<string, unknown>
      const value = templates?.[lang]
      if (typeof value === "string") return value
    }
  } catch {
    // Fall through to the legacy per-language key.
  }
  return localStorage.getItem(`ails_template_${lang}`)
}

export function writePersistedTemplate(lang: string, value: string) {
  try {
    const rawTemplates = localStorage.getItem(CODE_SANDBOX_TEMPLATES_KEY)
    const templates = rawTemplates ? JSON.parse(rawTemplates) as Record<string, unknown> : {}
    templates[lang] = value
    localStorage.setItem(CODE_SANDBOX_TEMPLATES_KEY, JSON.stringify(templates))
  } catch {
    localStorage.setItem(CODE_SANDBOX_TEMPLATES_KEY, JSON.stringify({ [lang]: value }))
  }
  localStorage.setItem(`ails_template_${lang}`, value)
}

export interface SandboxFile {
  id: string
  name: string
  code: string
  savedCode: string
  language: string
}

export function detectLanguageFromExtension(fileName: string, customProfiles: LanguageProfile[] = []): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || ""
  switch (ext) {
    case "py":
      return "python"
    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return "cpp"
    case "c":
      return "c"
    case "cs":
      return "csharp"
    case "js":
    case "jsx":
      return "javascript"
    case "ts":
    case "tsx":
      return "typescript"
    case "java":
      return "java"
    case "go":
      return "go"
    case "rs":
      return "rust"
    case "lua":
      return "lua"
    case "html":
      return "html"
    case "css":
      return "css"
    case "json":
      return "json"
    case "md":
      return "markdown"
    case "sql":
      return "sql"
    case "sh":
    case "bat":
    case "ps1":
      return "shell"
    default:
      return customProfiles.find((profile) => profile.extensions.includes(ext))?.id || codeLanguageForPath(fileName) || "plaintext"
  }
}

export function getLanguageLabel(lang: string, customProfiles: LanguageProfile[] = []): string {
  switch (lang) {
    case "python":
      return "Python"
    case "cpp":
      return "C++"
    case "c":
      return "C"
    case "csharp":
      return "C#"
    case "javascript": return "JavaScript"
    case "typescript": return "TypeScript"
    case "java": return "Java"
    case "go": return "Go"
    case "rust": return "Rust"
    case "lua": return "Lua"
    case "html": return "HTML"
    case "css": return "CSS"
    case "json": return "JSON"
    case "markdown": return "Markdown"
    case "sql": return "SQL"
    case "shell": return "Shell"
    default:
      return customProfiles.find((profile) => profile.id === lang)?.label || "PlainText"
  }
}

export function monacoLanguageForFile(file: SandboxFile) {
  if (file.language === "c") return "cpp"
  return file.language || "plaintext"
}

export function fallbackTemplate(lang: string): string {
  switch (lang) {
    case "python":
      return 'print("Hello Python!")\n'
    case "cpp":
      return '#include <iostream>\n\nint main() {\n    std::cout << "Hello C++!" << std::endl;\n    return 0;\n}\n'
    case "c":
      return '#include <stdio.h>\n\nint main() {\n    printf("Hello C!\\n");\n    return 0;\n}\n'
    case "csharp":
      return 'using System;\n\nclass Program {\n    static void Main() {\n        Console.WriteLine("Hello C#!");\n    }\n}\n'
    case "rust":
      return 'fn main() {\n    println!("Hello Rust!");\n}\n'
    case "java":
      return 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello Java!");\n    }\n}\n'
    case "lua":
      return 'print("Hello Lua!")\n'
    case "go":
      return 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello Go!")\n}\n'
    case "javascript":
      return 'console.log("Hello JavaScript!")\n'
    case "typescript":
      return 'const message: string = "Hello TypeScript!"\nconsole.log(message)\n'
    default:
      return ""
  }
}

export function getLanguageTemplate(fileName: string, customProfiles: LanguageProfile[] = []): string {
  const lang = detectLanguageFromExtension(fileName, customProfiles)
  const customTemplate = readPersistedTemplate(lang)
  if (customTemplate !== null) return customTemplate
  if (lang === "cpp" && (fileName.endsWith(".h") || fileName.endsWith(".hpp"))) {
    const guard = fileName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase() + "_H"
    return `#ifndef ${guard}\n#define ${guard}\n\n\n#endif // ${guard}\n`
  }
  const profileTemplate = customProfiles.find((profile) => profile.id === lang)?.template
  return profileTemplate || fallbackTemplate(lang)
}

export function normalizeFileName(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim()
}

export function parentFolder(fileName: string) {
  const normalized = normalizeFileName(fileName)
  const slash = normalized.lastIndexOf("/")
  return slash > 0 ? normalized.slice(0, slash) : ""
}

export function baseName(fileName: string) {
  const normalized = normalizeFileName(fileName)
  return normalized.split("/").pop() || normalized
}

export function createSandboxFile(name: string, customProfiles: LanguageProfile[] = []): SandboxFile {
  const normalized = normalizeFileName(name) || "main.py"
  const code = getLanguageTemplate(normalized, customProfiles)
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: normalized,
    code,
    savedCode: code,
    language: detectLanguageFromExtension(normalized, customProfiles),
  }
}

export function isTextEntryElement(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], .monaco-findInput, .find-widget",
    ),
  )
}

export function isMonacoEditorElement(element: EventTarget | null): boolean {
  return element instanceof HTMLElement && Boolean(element.closest(".monaco-editor"))
}

export function aiIssueTrackingKey(issue: CodeReviewIssue, index: number) {
  return [
    index,
    normalizeFileName(issue.file || "").toLowerCase(),
    issue.severity || "",
    issue.title || "",
    issue.explanation || "",
    issue.fix || "",
  ].join("\u001f")
}

export function issueColorClass(severity: CodeReviewIssue["severity"]) {
  if (severity === "error") return "text-red-600 dark:text-red-400"
  if (severity === "warning") return "text-amber-600 dark:text-amber-300"
  return "text-sky-600 dark:text-sky-400"
}

export function issueBadgeClass(severity: CodeReviewIssue["severity"]) {
  if (severity === "error") return "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
  if (severity === "warning") return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
  return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30"
}

export function issueSeverityLabel(severity: CodeReviewIssue["severity"]) {
  if (severity === "error") return t("오류")
  if (severity === "warning") return t("경고")
  return t("정보")
}

export function fileNameFromCompilerPath(value: string) {
  const normalized = value.replace(/\\/g, "/")
  return normalized.split("/").pop() || normalized
}

export function isProblemMetadataFile(fileName: string) {
  const name = baseName(fileName).toLocaleLowerCase()
  return name === ".ails-problem.json"
    || name.startsWith(".ails-problems")
    || name === ".ails-code-project"
}

export function stderrLineColor(line: string) {
  if (/\b(?:fatal error|error|exception|traceback|failed):/i.test(line) || /\b\d+ errors? generated\.?$/i.test(line) || /^\w+(?:Error|Exception):/i.test(line)) {
    return "text-red-600 dark:text-red-400"
  }
  if (/\bwarning:/i.test(line) || /\b\d+ warnings?(?: and \d+ errors?)? generated\.?$/i.test(line)) {
    return "text-amber-700 dark:text-amber-300"
  }
  if (/\bnote:/i.test(line)) {
    return "text-slate-600 dark:text-zinc-400"
  }
  return "text-red-700 dark:text-rose-300"
}

export function buildLocalRunIssues(runResult: CodeReviewRunResult, activeFile: SandboxFile): CodeReviewIssue[] {
  if (runResult?.success !== false) return []
  const stderr = String(runResult?.stderr || "")
  const stdout = String(runResult?.stdout || "")
  const text = `${stderr}\n${stdout}`.trim()
  if (!text) {
    return [{
      file: activeFile.name,
      line: 1,
      column: 1,
      severity: "error",
      title: t("실행 오류"),
      explanation: t("프로그램이 실패했지만 출력된 오류 메시지가 없습니다."),
      fix: t("실행 환경과 입력값을 확인하세요."),
    }]
  }

  const issues: CodeReviewIssue[] = []
  for (const line of text.split(/\r?\n/)) {
    const compileMatch = line.match(/^(.+):(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.+)$/i)
    if (compileMatch) {
      const reportedFile = fileNameFromCompilerPath(compileMatch[1])
      const file =
        reportedFile.toLowerCase() === baseName(activeFile.name).toLowerCase()
          ? activeFile.name
          : reportedFile
      issues.push({
        file,
        line: Math.max(1, Number(compileMatch[2]) || 1),
        column: Math.max(1, Number(compileMatch[3]) || 1),
        severity: compileMatch[4].toLowerCase().includes("warning") ? "warning" : "error",
        title: compileMatch[4].toLowerCase().includes("warning") ? t("컴파일 경고") : t("컴파일 오류"),
        explanation: compileMatch[5].trim(),
        fix: t("표시된 줄의 문법, 선언, 포인터/구조체 접근, 누락된 헤더를 확인하세요."),
      })
    }
  }

  if (issues.length > 0) return issues

  const pythonLocation = [...text.matchAll(/File\s+"([^"]+)",\s+line\s+(\d+)/g)].pop()
  const lastLine = text.split(/\r?\n/).filter((line) => line.trim()).pop() || t("실행 오류가 발생했습니다.")
  if (pythonLocation) {
    const reportedFile = fileNameFromCompilerPath(pythonLocation[1])
    return [{
      file: reportedFile.toLowerCase() === baseName(activeFile.name).toLowerCase() ? activeFile.name : reportedFile,
      line: Math.max(1, Number(pythonLocation[2]) || 1),
      column: 1,
      severity: "error",
      title: t("런타임 오류"),
      explanation: lastLine,
      fix: t("표시된 줄에서 예외를 발생시킨 표현식과 입력값을 확인하세요."),
    }]
  }

  return [{
    file: activeFile.name,
    line: 1,
    column: 1,
    severity: "error",
    title: t("실행 오류"),
    explanation: text.slice(0, 800),
    fix: t("콘솔 로그의 첫 번째 오류 위치부터 확인하세요."),
  }]
}

export function normalizedCodeText(value: string) {
  return value.replace(/\s+/g, "")
}

export function extractIssueCodeHints(issue: CodeReviewIssue) {
  const joined = `${issue.title || ""}\n${issue.explanation || ""}\n${issue.fix || ""}`
  const hints: string[] = []
  for (const match of joined.matchAll(/`([^`]{3,180})`/g)) {
    hints.push(match[1])
  }
  return Array.from(new Set(hints.map((hint) => hint.trim()).filter((hint) => hint.length >= 3)))
}

export function reconcileReviewIssuesWithSource(issues: CodeReviewIssue[], projectFiles: SandboxFile[]) {
  return issues.map((issue) => {
    const issueFile = normalizeFileName(issue.file || "")
    const exactFile = projectFiles.find(
      (file) => normalizeFileName(file.name).toLowerCase() === issueFile.toLowerCase(),
    )
    const basenameMatches = issueFile
      ? projectFiles.filter((file) => baseName(file.name).toLowerCase() === baseName(issueFile).toLowerCase())
      : []
    const targetFile = exactFile || (basenameMatches.length === 1 ? basenameMatches[0] : undefined)
    if (!targetFile) return issue

    const lines = targetFile.code.split(/\r?\n/)
    const currentLine = Math.max(1, Math.min(lines.length, Number(issue.line || 1)))
    const hints = extractIssueCodeHints(issue)

    for (const hint of hints) {
      const compactHint = normalizedCodeText(hint)
      if (!compactHint) continue
      if (normalizedCodeText(lines[currentLine - 1] || "").includes(compactHint)) break
      const matches = lines
        .map((line, index) => normalizedCodeText(line).includes(compactHint) ? index : -1)
        .filter((index) => index >= 0)
      if (matches.length === 1) return { ...issue, file: targetFile.name, line: matches[0] + 1, column: 1 }
    }

    return { ...issue, file: targetFile.name, line: currentLine }
  })
}

export function trimExtractedCodeBlock(value: string) {
  let next = String(value || "").replace(/\r\n?/g, "\n")
  next = next.replace(/^(?:[ \t]*\n)+/, "")
  next = next.replace(/(?:\n[ \t]*)+$/, "")
  return next
}

export function projectPathForPdfProblem(problem: PdfProblem, baseDir: string) {
  const folderPath = normalizeProjectPath(problem.folder_path || "")
  const normalizedBase = normalizeProjectPath(baseDir)
  if (!folderPath || !normalizedBase) return folderPath
  const lowerFolder = folderPath.toLocaleLowerCase()
  const lowerBase = normalizedBase.toLocaleLowerCase()
  if (lowerFolder === lowerBase) return ""
  if (lowerFolder.startsWith(`${lowerBase}/`)) return folderPath.slice(normalizedBase.length + 1)
  return folderPath
}

export function codeProjectLoadScope(baseDir: string, projectName: string) {
  return `${normalizeProjectPath(baseDir).toLocaleLowerCase()}\u0000${normalizeProjectPath(projectName).toLocaleLowerCase()}`
}

export function problemAnswerSignature(answerText: string, selectedChoice: number | null) {
  return JSON.stringify([String(answerText || ""), selectedChoice])
}

export interface CodeRunSnapshot {
  consoleEncoding?: import("../../../lib/api.ts").CodeConsoleEncoding
  signature: string
  action: "run" | "build" | "test"
  success: boolean | null
  returncode: number | null
  stdout: string
  stderr: string
  status: ConsoleStatus
}
