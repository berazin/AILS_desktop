import { requestJson } from "./core.ts"
import type { ReportSummary } from "./core.ts"

export interface AILSReport extends ReportSummary {
  content: string
  raw_content?: string
  usage_summary?: unknown
}

export function importMarkdown(payload: { title?: string; path?: string; content?: string }) {
  return requestJson<{ report: AILSReport }>("/reports/import", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function cancelCurrentTask() {
  return requestJson<{ cancelled: boolean }>("/tasks/cancel-current", { method: "POST" })
}

export function pauseCurrentTask() {
  return requestJson<{ paused: boolean }>("/tasks/pause-current", { method: "POST" })
}

export function resumeCurrentTask() {
  return requestJson<{ resumed: boolean }>("/tasks/resume-current", { method: "POST" })
}

export function cancelAllTasks() {
  return requestJson<{ cancelled: boolean }>("/tasks/cancel-all", { method: "POST" })
}

export function cancelTask(taskId: number) {
  return requestJson<{ cancelled: boolean }>(`/tasks/${taskId}/cancel`, { method: "POST" })
}

export function pauseTask(taskId: number) {
  return requestJson<{ paused: boolean }>(`/tasks/${taskId}/pause`, { method: "POST" })
}

export function resumeTask(taskId: number) {
  return requestJson<{ resumed: boolean }>(`/tasks/${taskId}/resume`, { method: "POST" })
}

export function cancelPendingTask(taskId: number) {
  return requestJson<{ deleted: boolean }>(`/tasks/${taskId}`, { method: "DELETE" })
}

export function getReport(reportId: string) {
  return requestJson<{ report: AILSReport }>(`/reports/${encodeURIComponent(reportId)}`)
}

export function runLatexPostprocess() {
  return requestJson<{ updated: number; unchanged: number; failed: Array<unknown> }>(
    "/actions/latex-postprocess",
    { method: "POST" },
  )
}

export function organizeReports() {
  return requestJson<{
    moved_markdowns: number
    moved_image_dirs: number
    skipped_files: string[]
    messages: string[]
  }>("/actions/organize-reports", { method: "POST" })
}

export function retryFailedTask(title: string) {
  return requestJson<{ task_id: number }>(`/retry/${encodeURIComponent(title)}`, { method: "POST" })
}

export function retryAllFailedTasks() {
  return requestJson<{
    queued: Array<{ title: string; task_id: number }>
    failed: Array<{ title: string; reason: string }>
  }>("/retry-all", { method: "POST" })
}

export function deleteRetryCandidate(title: string) {
  return requestJson<{ deleted: boolean; title: string }>(`/retry/${encodeURIComponent(title)}`, {
    method: "DELETE",
  })
}
