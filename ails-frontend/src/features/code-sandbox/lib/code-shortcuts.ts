import { t } from "../../../lib/i18n.ts"
export const CODE_SHORTCUT_ACTIONS = [
  "run",
  "save",
  "saveAll",
  "newFile",
  "newProject",
  "closeFile",
  "renameFile",
  "nextTab",
  "previousTab",
  "nextProject",
  "previousProject",
  "nextPdfPage",
  "previousPdfPage",
  "promptEdit",
  "toggleChatbot",
] as const

export type CodeShortcutAction = (typeof CODE_SHORTCUT_ACTIONS)[number]
export type CodeKeymapProfile = "vscode" | "visualstudio" | "jetbrains"
export type CodeShortcutMap = Record<CodeShortcutAction, string>
export type CodeShortcutOverrides = Partial<Record<CodeShortcutAction, string>>
export type CodeShortcutOverridesByProfile = Partial<Record<CodeKeymapProfile, CodeShortcutOverrides>>

export interface CodeShortcutDefinition {
  action: CodeShortcutAction
  label: string
  group: string
}

export interface ShortcutKeyboardEvent {
  altKey: boolean
  code: string
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
}

export const CODE_SHORTCUT_DEFINITIONS: readonly CodeShortcutDefinition[] = [
  { action: "run", label: "코드 실행 / 실행 중지", group: "실행 및 저장" },
  { action: "save", label: "현재 파일 저장", group: "실행 및 저장" },
  { action: "saveAll", label: "모든 파일 저장", group: "실행 및 저장" },
  { action: "newFile", label: "새 파일", group: "파일 및 프로젝트" },
  { action: "newProject", label: "새 프로젝트", group: "파일 및 프로젝트" },
  { action: "closeFile", label: "현재 파일 닫기", group: "파일 및 프로젝트" },
  { action: "renameFile", label: "현재 파일 이름 변경", group: "파일 및 프로젝트" },
  { action: "nextTab", label: "다음 파일 탭", group: "파일 및 프로젝트" },
  { action: "previousTab", label: "이전 파일 탭", group: "파일 및 프로젝트" },
  { action: "nextProject", label: "다음 프로젝트", group: "파일 및 프로젝트" },
  { action: "previousProject", label: "이전 프로젝트", group: "파일 및 프로젝트" },
  { action: "nextPdfPage", label: "PDF 다음 페이지", group: "학습 및 AI" },
  { action: "previousPdfPage", label: "PDF 이전 페이지", group: "학습 및 AI" },
  { action: "promptEdit", label: "AI 코드 수정", group: "학습 및 AI" },
  { action: "toggleChatbot", label: "챗봇 열기 / 닫기", group: "학습 및 AI" },
]

const COMMON_DEFAULTS: Omit<CodeShortcutMap, "run" | "newFile"> = {
  save: "Ctrl+S",
  saveAll: "Ctrl+Alt+S",
  newProject: "Ctrl+Shift+P",
  closeFile: "Ctrl+W",
  renameFile: "F2",
  nextTab: "Ctrl+Tab",
  previousTab: "Ctrl+Shift+Tab",
  nextProject: "Ctrl+Alt+ArrowRight",
  previousProject: "Ctrl+Alt+ArrowLeft",
  nextPdfPage: "Alt+ArrowRight",
  previousPdfPage: "Alt+ArrowLeft",
  promptEdit: "Alt+Shift+P",
  toggleChatbot: "Shift+Space",
}

export function isCodeKeymapProfile(value: string): value is CodeKeymapProfile {
  return value === "vscode" || value === "visualstudio" || value === "jetbrains"
}

export function getDefaultCodeShortcuts(profile: CodeKeymapProfile): CodeShortcutMap {
  return {
    ...COMMON_DEFAULTS,
    run: profile === "vscode" ? "Ctrl+Enter" : profile === "jetbrains" ? "Shift+F10" : "F5",
    newFile: profile === "jetbrains" ? "Alt+Insert" : "Ctrl+Shift+A",
  }
}

export function resolveCodeShortcuts(
  profile: CodeKeymapProfile,
  overrides: CodeShortcutOverrides = {},
): CodeShortcutMap {
  return { ...getDefaultCodeShortcuts(profile), ...overrides }
}

function eventKey(event: ShortcutKeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3)
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5)
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.code)) return event.code

  const namedCodes: Record<string, string> = {
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    Backspace: "Backspace",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Equal: "=",
    Home: "Home",
    Insert: "Insert",
    Minus: "-",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Period: ".",
    Semicolon: ";",
    Slash: "/",
    Space: "Space",
    Tab: "Tab",
  }
  const fromCode = namedCodes[event.code]
  if (fromCode) return fromCode
  if (event.key.length === 1 && event.key.trim()) return event.key.toUpperCase()
  return null
}

export function keyboardEventToShortcut(event: ShortcutKeyboardEvent): string | null {
  const key = eventKey(event)
  if (!key) return null

  const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
  if (!hasModifier && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return null

  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl")
  if (event.altKey) parts.push("Alt")
  if (event.shiftKey) parts.push("Shift")
  parts.push(key)
  return parts.join("+")
}

export function shortcutMatchesEvent(shortcut: string, event: ShortcutKeyboardEvent): boolean {
  if (!shortcut) return false
  return keyboardEventToShortcut(event) === shortcut
}

export function formatCodeShortcut(shortcut: string): string {
  if (!shortcut) return t("사용 안 함")
  return shortcut
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .split("+")
    .join(" + ")
}

export function findShortcutConflict(
  shortcuts: CodeShortcutMap,
  action: CodeShortcutAction,
  shortcut: string,
): CodeShortcutDefinition | null {
  if (!shortcut) return null
  const conflict = CODE_SHORTCUT_DEFINITIONS.find(
    (definition) => definition.action !== action && shortcuts[definition.action] === shortcut,
  )
  return conflict ?? null
}
