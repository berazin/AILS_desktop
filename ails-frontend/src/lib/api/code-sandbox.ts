import { apiBase, apiHeaders, requestJson } from "./core.ts"
export type CodeConsoleEncoding = "auto" | "utf-8" | "cp949"

export interface CodeSandboxFilePayload {
  name: string
  code: string
}

export interface CodeSandboxRunPayload {
  console_encoding?: CodeConsoleEncoding
  code: string
  language: string
  file_name?: string
  files?: CodeSandboxFilePayload[]
  stdin?: string
  timeout?: number
  action?: string
}

export interface CodeSandboxRunResult {
  success: boolean
  stdout: string
  stderr: string
  error?: string
}

export function runCodeSandbox(payload: CodeSandboxRunPayload, signal?: AbortSignal) {
  return requestJson<CodeSandboxRunResult>('/code/run', { method: 'POST', body: JSON.stringify(payload), signal });
}

export type CodeRunSessionStatus = "running" | "exited" | "stopped" | "timed_out" | "failed"

export interface CodeRunSessionStartPayload {
  console_encoding?: CodeConsoleEncoding
  workspace_id?: string
  code: string
  language: string
  file_name?: string
  files?: Array<{ name: string; code: string }>
  stdin?: string
  timeout?: number
  action?: string
}

export interface CodeRunSessionFailure {
  success: false
  status: CodeRunSessionStatus
  error: string
  diagnostics?: string
  stdout?: string
  stderr?: string
}

export interface CodeRunSessionStarted {
  success: true
  session_id: string
  status: CodeRunSessionStatus
  stdout_offset: number
  stderr_offset: number
  diagnostics: string
}

export type CodeRunSessionStartResult = CodeRunSessionStarted | CodeRunSessionFailure

export interface CodeRunStreamSuccess {
  success: true
  session_id: string
  status: CodeRunSessionStatus
  stdout: string
  stderr: string
  stdout_offset: number
  stderr_offset: number
  returncode: number | null
  truncated: boolean
  more_output: boolean
}

export type CodeRunStreamResult = CodeRunStreamSuccess | CodeRunSessionFailure

export interface CodeRunSessionMutationSuccess {
  success: true
  status: CodeRunSessionStatus
}

export type CodeRunSessionMutationResult = CodeRunSessionMutationSuccess | CodeRunSessionFailure

export function startCodeSandboxSession(payload: CodeRunSessionStartPayload, signal?: AbortSignal) {
  return requestJson<CodeRunSessionStartResult>('/code/run/start', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function streamCodeSandboxSession(
  sessionId: string,
  stdoutOffset: number,
  stderrOffset: number,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    session_id: sessionId,
    stdout_offset: String(stdoutOffset),
    stderr_offset: String(stderrOffset),
    wait: '0.5',
  })
  return requestJson<CodeRunStreamResult>(`/code/run/stream?${params.toString()}`, { signal })
}

export function sendCodeSandboxInput(sessionId: string, input: string, eof = false, signal?: AbortSignal) {
  return requestJson<CodeRunSessionMutationResult>('/code/run/input', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, input, eof }),
    signal,
  })
}

export function stopCodeSandboxSession(sessionId: string, signal?: AbortSignal) {
  return requestJson<CodeRunSessionMutationResult>('/code/run/stop', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
    signal,
  })
}
export interface CodeReviewIssue {
  file: string
  line: number
  column?: number
  severity: "error" | "warning" | "info"
  title: string
  explanation: string
  fix?: string
}

export interface CodeReviewResult {
  summary: string
  can_run?: boolean | null
  issues: CodeReviewIssue[]
  model?: string
  provider?: string
}

export interface CodeReviewRunResult {
  success?: boolean | null
  returncode?: number | null
  stdout?: string
  stderr?: string
  error?: string
  diagnostics?: string
}

export interface CodeReviewRequestPayload {
  include_nested_files?: boolean
  project_name?: string
  code: string
  language: string
  file_name?: string
  files?: CodeSandboxFilePayload[]
  run_result?: CodeReviewRunResult
}

export function reviewCodeSandbox(payload: CodeReviewRequestPayload, signal?: AbortSignal) {
  return requestJson<CodeReviewResult>('/code/review', { method: 'POST', body: JSON.stringify(payload), signal });
}

export interface CodeReviewStreamHandlers {
  onIssue?: (issue: CodeReviewIssue) => void
  onDone?: (result: CodeReviewResult) => void
}

export async function reviewCodeSandboxStream(
  payload: CodeReviewRequestPayload,
  handlers: CodeReviewStreamHandlers = {},
  signal?: AbortSignal,
): Promise<CodeReviewResult> {
  const response = await fetch(`${apiBase}/code/review/stream`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `API request failed: ${response.status}`)
  }
  if (!response.body) throw new Error('Code review stream is not available in this browser.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: CodeReviewResult | null = null

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const event = JSON.parse(trimmed) as { type?: string; issue?: CodeReviewIssue; result?: CodeReviewResult; error?: string }
    if (event.type === 'issue' && event.issue) handlers.onIssue?.(event.issue)
    else if (event.type === 'done' && event.result) {
      finalResult = event.result
      handlers.onDone?.(event.result)
    } else if (event.type === 'error') throw new Error(event.error || 'Code review stream failed.')
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }
  buffer += decoder.decode()
  if (buffer.trim()) handleLine(buffer)
  if (!finalResult) throw new Error('Code review stream ended before completion.')
  return finalResult
}
export interface PdfRegionOcrResult {
  text: string
  page?: number
  engine?: string
  language?: string
  ai_reviewed: false
}

export interface PdfRegionSelection {
  left: number
  top: number
  right: number
  bottom: number
}

export function extractPdfRegionText(
  payload: { path: string; page: number; region: PdfRegionSelection },
  signal?: AbortSignal,
) {
  return requestJson<PdfRegionOcrResult>('/code/ocr-region', { method: 'POST', body: JSON.stringify(payload), signal });
}
export function saveCodeProject(payload: { base_dir: string; project_name: string; files: CodeSandboxFilePayload[] }, signal?: AbortSignal) {
  return requestJson<{ success: boolean; saved_dir?: string; files?: string[]; error?: string }>('/code/save', { method: 'POST', body: JSON.stringify(payload), signal });
}
export interface CodeProjectsPayload {
  success: boolean
  projects: string[]
  managed_projects: string[]
  error?: string
}

export function getCodeProjects(payload: { base_dir: string }) {
  return requestJson<CodeProjectsPayload>('/code/projects', { method: 'POST', body: JSON.stringify(payload) });
}
export function getCodeProjectFiles(payload: { base_dir: string; project_name: string }) {
  return requestJson<{ success: boolean; files: CodeSandboxFilePayload[]; error?: string }>('/code/project-files', { method: 'POST', body: JSON.stringify(payload) });
}
export function createCodeProject(payload: { base_dir: string; project_name: string }) {
  return requestJson<{ success: boolean; project_name?: string; project_dir?: string; created_files?: string[]; error?: string }>('/code/projects/create', { method: 'POST', body: JSON.stringify(payload) });
}
export function deleteCodeProject(payload: { base_dir: string; project_name: string }) {
  return requestJson<{ success: boolean; error?: string }>('/code/projects/delete', { method: 'POST', body: JSON.stringify(payload) });
}
export function deleteCodeProjectFile(payload: { base_dir: string; project_name: string; file_name: string }, signal?: AbortSignal) {
  return requestJson<{ success: boolean; error?: string }>('/code/projects/delete-file', { method: 'POST', body: JSON.stringify(payload), signal });
}
export function renameCodeProject(payload: { base_dir: string; old_project_name: string; new_project_name: string }) {
  return requestJson<{ success: boolean; error?: string }>('/code/projects/rename', { method: 'POST', body: JSON.stringify(payload) });
}
export interface CodePromptEditPayload {
  file_name: string
  language: string
  code: string
  instruction: string
  files?: CodeSandboxFilePayload[]
}

export function promptEditCodeSandbox(payload: CodePromptEditPayload, signal?: AbortSignal) {
  return requestJson<{ code: string; model: string; provider: string; usage?: Record<string, unknown> }>('/code/prompt-edit', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}
