import type { ActiveTaskStatus, AILSStatus, PendingTask, RetryCandidate } from "../../../lib/api"

export type DocumentationStatus = {
  activeTasks: ActiveTaskStatus[]
  currentStatus?: AILSStatus | null
  pending: PendingTask[]
  retryCandidates: RetryCandidate[]
}

export type DocumentationQueueItem = {
  key: string
  title: string
  type: string
  kind: "active" | "pending" | "retry"
  taskId: number | null
  state: "running" | "paused" | "cancelling" | "pending" | "failed" | "needs_review"
  percent: number
  indeterminate: boolean
  label: string
  error?: string
}

export function documentationQueueItems(status?: DocumentationStatus): DocumentationQueueItem[] {
  if (!status) return []
  const items: DocumentationQueueItem[] = []
  const ids = new Set<number>()
  const busyTitles = new Set<string>()
  const active = status.activeTasks.length ? status.activeTasks : status.currentStatus?.is_running ? [{
    ...status.currentStatus, task_id: status.currentStatus.current_task_id ?? null, title: status.currentStatus.current_title, type: "",
  }] : []
  for (const task of active) {
    if (task.task_id !== null && ids.has(task.task_id)) continue
    if (task.task_id !== null) ids.add(task.task_id)
    busyTitles.add(task.title)
    const progress = Number(task.progress_percent ?? 0)
    items.push({ key: `active:${task.task_id ?? "current"}`, title: task.title, type: task.type,
      kind: "active", taskId: task.task_id,
      state: task.cancel_requested ? "cancelling" : task.is_paused ? "paused" : "running",
      percent: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
      indeterminate: Boolean(task.progress_indeterminate), label: task.progress_label?.trim() ?? "" })
  }
  for (const task of status.pending) {
    if (ids.has(task.id)) continue
    ids.add(task.id)
    busyTitles.add(task.title)
    items.push({ key: `pending:${task.id}`, title: task.title, type: task.type, kind: "pending", taskId: task.id,
      state: "pending", percent: 0, indeterminate: false, label: "" })
  }
  const retryTitles = new Set<string>()
  for (const task of status.retryCandidates) {
    if (task.active || busyTitles.has(task.title) || retryTitles.has(task.title)) continue
    retryTitles.add(task.title)
    items.push({ key: `retry:${task.title}`, title: task.title, type: task.task_type, kind: "retry", taskId: null,
      state: task.status === "needs_review" ? "needs_review" : "failed", percent: 0, indeterminate: false,
      label: "", error: task.last_error })
  }
  return items
}

export function documentationWorkCount(status?: DocumentationStatus) {
  return documentationQueueItems(status).filter(item => item.kind !== "retry").length
}

export function filterDocumentationQueue(items: DocumentationQueueItem[], query: string) {
  const search = query.trim().toLocaleLowerCase()
  return search ? items.filter(item => [item.title, item.type, item.label, item.error].some(value => value?.toLocaleLowerCase().includes(search))) : items
}
