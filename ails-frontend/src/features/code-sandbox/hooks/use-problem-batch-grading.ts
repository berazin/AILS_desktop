import { useSyncExternalStore } from "react"
import { gradePdfProblemsBatch, type PdfProblemBatchGradeResponse, type PdfProblemBatchGradeItem, type PdfProblemGradePayload } from "../../../lib/api.ts"
import { t } from "../../../lib/i18n.ts"
import type { ProblemBatchProgress } from "../lib/code-sandbox-support.ts"

export type BackgroundProblemBatch = ProblemBatchProgress & {
  id: string
  pdfPath: string
  baseDir: string
  problemIds: string[]
  results: PdfProblemBatchGradeResponse["results"]
}
type Submission = Omit<PdfProblemGradePayload, "pdf_path" | "base_dir">

// The request and its results belong to the app session, never to a mounted PDF/window.
let batches: BackgroundProblemBatch[] = []
const listeners = new Set<() => void>()
const controllers = new Map<string, AbortController>()
function publish(id: string, patch: Partial<BackgroundProblemBatch>) {
  batches = batches.map(batch => batch.id === id ? { ...batch, ...patch } : batch)
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const snapshot = () => batches

export function useProblemBatchGrading() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function startBackgroundProblemBatch({ pdfPath, baseDir, total, items }: {
  pdfPath: string; baseDir: string; total: number; items: Submission[]
}) {
  const normalizedPath = pdfPath.replace(/\\/g, "/").toLowerCase()
  if (batches.some(batch => batch.status === "running" && batch.pdfPath.replace(/\\/g, "/").toLowerCase() === normalizedPath
    && items.some(item => batch.problemIds.includes(item.problem_id)))) {
    throw new Error(t("선택한 문제의 채점이 이미 진행 중입니다."))
  }
  const id = crypto.randomUUID()
  const skipped = total - items.length
  const controller = new AbortController()
  const batch: BackgroundProblemBatch = { id, pdfPath, baseDir, problemIds: items.map(item => item.problem_id),
    status: items.length ? "running" : "completed", total, completed: skipped, skipped,
    correct: 0, incorrect: 0, failed: 0, unresolved: 0, currentLabel: items.length ? t("선택한 문제를 채점하고 있습니다. 답지가 없으면 AI가 평가합니다.") : "", results: [] }
  batches = [...batches, batch]
  for (const listener of listeners) listener()
  if (!items.length) return id
  controllers.set(id, controller)
  const results = new Map<string, PdfProblemBatchGradeItem>()
  const expectedIds = new Set(items.map(item => item.problem_id))
  const counts = () => {
    let correct = 0, incorrect = 0, failed = 0, unresolved = 0
    for (const item of results.values()) {
      if (item.result?.verdict === "unresolved") unresolved += 1
      else if (!item.result || item.error || item.result.application_status === "stale") failed += 1
      else if (item.result.correct) correct += 1
      else incorrect += 1
    }
    return { correct, incorrect, failed, unresolved, completed: skipped + results.size, results: [...results.values()] }
  }
  const receive = (item: PdfProblemBatchGradeItem) => {
    if (controller.signal.aborted || !expectedIds.has(item.problem_id)) return
    results.set(item.problem_id, item)
    publish(id, { ...counts(), currentLabel: item.error
      ?? (item.result?.verdict === "unresolved" ? item.result.feedback : item.result?.application_status === "stale" ? t("답안이 변경된 문제의 채점 결과는 적용하지 않았습니다.")
        : t("완성된 문제부터 채점 결과를 반영하고 있습니다.")) })
  }
  // No caller awaits this task, and view changes never abort its request.
  void gradePdfProblemsBatch({ pdf_path: pdfPath, base_dir: baseDir, items }, controller.signal, receive).then(response => {
    if (controller.signal.aborted) return
    for (const item of response.results) {
      if (expectedIds.has(item.problem_id)) results.set(item.problem_id, item)
    }
    const current = counts()
    const missing = items.length - results.size
    publish(id, { ...current, status: response.cancelled ? "cancelled" : response.error || missing ? "failed" : "completed",
      completed: response.cancelled ? current.completed : total,
      failed: current.failed + (response.cancelled ? 0 : missing),
      currentLabel: response.error ?? response.results.find(item => item.error)?.error
        ?? (missing && !response.cancelled ? t("일부 문제의 채점 결과를 받지 못했습니다.")
          : response.results.some(item => item.result?.application_status === "stale") ? t("답안이 변경된 문제의 채점 결과는 적용하지 않았습니다.") : "") })
  }).catch(error => {
    const current = counts()
    publish(id, controller.signal.aborted ? { ...current, status: "cancelled", currentLabel: "" }
      : { ...current, status: "failed", completed: total, failed: current.failed + items.length - results.size,
        currentLabel: error instanceof Error ? error.message : String(error) })
  }).finally(() => controllers.delete(id))
  return id
}

export function cancelBackgroundProblemBatch(id: string) {
  controllers.get(id)?.abort()
}

export function dismissBackgroundProblemBatch(id: string) {
  if (controllers.has(id) || batches.find(batch => batch.id === id)?.status === "running") return
  batches = batches.filter(batch => batch.id !== id)
  for (const listener of listeners) listener()
}
