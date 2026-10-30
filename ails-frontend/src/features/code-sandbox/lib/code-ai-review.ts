import type { CodeReviewIssue, CodeReviewResult } from "../../../lib/api"

export type CodeAiReviewPhase =
  | "idle"
  | "running"
  | "analyzing"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled"

export interface CodeAiReviewSession {
  review: CodeReviewResult | null
  visible: boolean
  reviewing: boolean
  evaluatedSignature?: string
  error?: string | null
  phase?: CodeAiReviewPhase
}

const EMPTY_CODE_AI_REVIEW_SESSION: CodeAiReviewSession = {
  review: null,
  visible: false,
  reviewing: false,
  phase: "idle",
}

// Renderer-memory storage intentionally survives React window unmounts, but not an AILS restart.
const codeAiReviewSessions = new Map<string, CodeAiReviewSession>()

function normalizeScopePath(value: string) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLocaleLowerCase()
}

export function codeAiReviewScopeKey(baseDir: string, projectName: string) {
  const normalizedBaseDir = normalizeScopePath(baseDir)
  const normalizedProjectName = normalizeScopePath(projectName)
  if (!normalizedBaseDir || !normalizedProjectName) return ""
  return JSON.stringify([normalizedBaseDir, normalizedProjectName])
}

export function readCodeAiReviewSession(scopeKey: string): CodeAiReviewSession {
  return codeAiReviewSessions.get(scopeKey) ?? EMPTY_CODE_AI_REVIEW_SESSION
}

export function updateCodeAiReviewSession(
  scopeKey: string,
  update: (current: CodeAiReviewSession) => CodeAiReviewSession,
) {
  if (!scopeKey) return EMPTY_CODE_AI_REVIEW_SESSION
  const next = update(readCodeAiReviewSession(scopeKey))
  codeAiReviewSessions.set(scopeKey, next)
  return next
}

export function aiReviewIssueMatchesFile(issue: Pick<CodeReviewIssue, "file">, fileName: string) {
  const normalizedIssueFile = normalizeScopePath(issue.file || "")
  const normalizedFileName = normalizeScopePath(fileName)
  return Boolean(normalizedIssueFile && normalizedFileName && normalizedIssueFile === normalizedFileName)
}

export function filesForCodeAiReview<T extends { name: string }>(files: T[], includeNested = false) {
  return files.filter((file) => {
    const normalizedName = normalizeScopePath(file.name).replace(/^\/+/, "")
    return Boolean(normalizedName && (includeNested || !normalizedName.includes("/")) && !normalizedName.endsWith(".txt"))
  })
}

export function resetCodeAiReviewSessionsForTests() {
  codeAiReviewSessions.clear()
}
