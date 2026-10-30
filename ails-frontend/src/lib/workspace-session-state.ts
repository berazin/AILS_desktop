import { IDE_ENABLED } from "../edition.ts"
export const WORKSPACE_SESSION_STATE_KEY = IDE_ENABLED ? "ails-workspace-session-state" : "ails-workspace-session-state-commercial"

// 문제풀이 창(PDF 문제 학습)과 코드 에디터(독립 실행)를 구분하는 창 모드.
export type CodeSandboxWindowMode = "problems" | "code"

export type WorkspaceSessionState = {
  version: 1
  updatedAt: number
  material?: {
    filePath: string
    kind: string
    /** Legacy input only; document scroll positions are kept in memory. */
    scrollRatio?: number
    pdfPage?: number
  }
  viewer?: {
    fullscreenOpen?: boolean
  }
  pdfViewer?: {
    floating?: boolean
    position?: { x: number; y: number }
    size?: { width: number; height: number }
  }
  codeSandbox?: {
    open?: boolean
    baseDir?: string
    projectName?: string
    activeFileName?: string
    mode?: CodeSandboxWindowMode
  }
  chatbot?: {
    open?: boolean
    draft?: string
    buttonPosition?: { x: number; y: number }
  }
  layout?: {
    leftSidebarWidth?: number
    rightSidebarWidth?: number
    reportsPanelWidth?: number
  }
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function normalizedPage(value: unknown) {
  const number = finiteNumber(value)
  if (number === undefined || number < 1) return undefined
  return Math.floor(number)
}

function normalizedBool(value: unknown) {
  return typeof value === "boolean" ? value : undefined
}

function normalizedPoint(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const x = finiteNumber(record.x)
  const y = finiteNumber(record.y)
  if (x === undefined || y === undefined) return undefined
  return { x, y }
}

function normalizedSize(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const width = finiteNumber(record.width)
  const height = finiteNumber(record.height)
  if (width === undefined || height === undefined) return undefined
  return { width, height }
}

function normalizedString(value: unknown) {
  const text = String(value ?? "").trim()
  return text || undefined
}

function normalizedOptionalString(value: unknown) {
  if (value === undefined || value === null) return undefined
  return String(value).trim()
}

function normalizedWindowMode(value: unknown): CodeSandboxWindowMode | undefined {
  return value === "problems" || value === "code" ? value : undefined
}

export function buildWorkspaceSessionState(input: Partial<WorkspaceSessionState>): WorkspaceSessionState {
  const state: WorkspaceSessionState = {
    version: 1,
    updatedAt: Date.now(),
  }

  if (input.material?.filePath && input.material.kind) {
    state.material = {
      filePath: input.material.filePath,
      kind: input.material.kind,
      pdfPage: normalizedPage(input.material.pdfPage),
    }
  }

  if (input.viewer) {
    state.viewer = {
      fullscreenOpen: normalizedBool(input.viewer.fullscreenOpen),
    }
  }

  if (input.pdfViewer) {
    state.pdfViewer = {
      floating: normalizedBool(input.pdfViewer.floating),
      position: normalizedPoint(input.pdfViewer.position),
      size: normalizedSize(input.pdfViewer.size),
    }
  }

  if (input.codeSandbox) {
    state.codeSandbox = {
      open: normalizedBool(input.codeSandbox.open),
      baseDir: normalizedString(input.codeSandbox.baseDir),
      projectName: normalizedOptionalString(input.codeSandbox.projectName),
      activeFileName: normalizedOptionalString(input.codeSandbox.activeFileName),
      mode: normalizedWindowMode(input.codeSandbox.mode),
    }
  }

  if (input.chatbot) {
    state.chatbot = {
      open: normalizedBool(input.chatbot.open),
      draft: String(input.chatbot.draft ?? ""),
      buttonPosition: normalizedPoint(input.chatbot.buttonPosition),
    }
  }

  if (input.layout) {
    state.layout = {
      leftSidebarWidth: finiteNumber(input.layout.leftSidebarWidth),
      rightSidebarWidth: finiteNumber(input.layout.rightSidebarWidth),
      reportsPanelWidth: finiteNumber(input.layout.reportsPanelWidth),
    }
  }

  return state
}

export function readWorkspaceSessionState(storage: Pick<Storage, "getItem">): WorkspaceSessionState | null {
  try {
    const raw = storage.getItem(WORKSPACE_SESSION_STATE_KEY) || (!IDE_ENABLED ? storage.getItem("ails-workspace-session-state") : null)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkspaceSessionState>
    if (!parsed || typeof parsed !== "object") return null
    return buildWorkspaceSessionState(parsed)
  } catch {
    return null
  }
}

export function writeWorkspaceSessionState(storage: Pick<Storage, "setItem">, state: WorkspaceSessionState) {
  storage.setItem(WORKSPACE_SESSION_STATE_KEY, JSON.stringify(buildWorkspaceSessionState(state)))
}
