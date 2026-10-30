import { AlertTriangle, Clock, FileText, Loader2, Pause, Play, RotateCcw, Search, X } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"
import type { useTaskOperations } from "../hooks/use-task-operations.ts"
import { documentationQueueItems, filterDocumentationQueue, type DocumentationStatus } from "../lib/documentation-queue.ts"

export type DocumentationQueueProps = {
  status: DocumentationStatus
  actions: Pick<ReturnType<typeof useTaskOperations>, "handlePauseTask" | "handleResumeTask" | "handleCancelTask"
    | "handlePauseCurrent" | "handleResumeCurrent" | "handleCancelCurrent" | "handleCancelPending"
    | "handleRetryFailed" | "handleDeleteRetryCandidate">
  isBusy: (key: string) => boolean
  refresh: () => Promise<unknown>
}

const labels = { running: "진행 중", paused: "일시정지됨", cancelling: "취소 요청됨", pending: "대기", failed: "실패", needs_review: "확인 필요" }

export function DocumentationTaskList({ work, searchQuery, onSearchChange }: {
  work?: DocumentationQueueProps
  searchQuery: string
  onSearchChange: (value: string) => void
}) {
  const all = documentationQueueItems(work?.status)
  const items = filterDocumentationQueue(all, searchQuery)
  return <div className="flex min-h-0 flex-1 flex-col" data-documentation-task-list>
    <div className="space-y-3 border-b border-[var(--border)] p-4">
      <p className="text-xs text-[var(--muted-foreground)]">{t("정리본 생성")} · {t("진행")} {all.filter(item => item.kind === "active").length}
        {" · "}{t("대기")} {all.filter(item => item.kind === "pending").length}
        {" · "}{t("실패·확인 필요")} {all.filter(item => item.kind === "retry").length}</p>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input aria-label={t("문서화 작업 검색")} placeholder={t("문서화 작업 검색")} className="h-8 pl-8 text-xs" value={searchQuery} onChange={event => onSearchChange(event.target.value)} />
      </div>
    </div>
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
      {!items.length && <p className="py-10 text-center text-xs text-[var(--muted-foreground)]">{searchQuery ? t("검색 결과가 없습니다.") : t("문서화 작업이 없습니다.")}</p>}
      {items.map(item => {
        const icon = item.kind === "retry" ? <AlertTriangle size={14} className="text-amber-600" />
          : item.kind === "pending" ? <Clock size={14} /> : item.state === "paused" ? <Pause size={14} /> : <Loader2 size={14} className="animate-spin text-[var(--brand)]" />
        const taskId = item.taskId
        const paused = item.state === "paused"
        const pendingKey = taskId === null ? `${paused ? "resume" : "pause"}-current` : `${paused ? "resume" : "pause"}-task-${taskId}`
        return <article key={item.key} data-documentation-task={item.key} data-task-state={item.state} className="rounded-lg border border-[var(--border)] px-3 py-2.5 text-xs">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-[var(--muted-foreground)]">{icon}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={item.title}>{item.title || t("정리본 생성")}</p>
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t(labels[item.state])}</p>
            </div>
            {work && <div className="flex shrink-0 gap-1">
              {item.kind === "active" && <>
                <Button size="icon" variant="ghost" aria-label={t(paused ? "{p0} 재개" : "{p0} 일시정지", { p0: item.title })}
                  disabled={item.state === "cancelling" || work.isBusy(pendingKey)} onClick={() => void (taskId === null
                    ? paused ? work.actions.handleResumeCurrent() : work.actions.handlePauseCurrent()
                    : paused ? work.actions.handleResumeTask(taskId) : work.actions.handlePauseTask(taskId))}>
                  {paused ? <Play size={13} /> : <Pause size={13} />}
                </Button>
                <Button size="icon" variant="ghost" aria-label={t("{p0} 취소", { p0: item.title })}
                  disabled={item.state === "cancelling" || work.isBusy(taskId === null ? "cancel-current" : `cancel-task-${taskId}`)}
                  onClick={() => void (taskId === null ? work.actions.handleCancelCurrent() : work.actions.handleCancelTask(taskId))}><X size={13} /></Button>
              </>}
              {item.kind === "pending" && taskId !== null && <Button size="icon" variant="ghost" aria-label={t("{p0} 대기열에서 삭제", { p0: item.title })}
                disabled={work.isBusy(`cancel-pending-${taskId}`)} onClick={() => void work.actions.handleCancelPending(taskId)}><X size={13} /></Button>}
              {item.kind === "retry" && <>
                <Button size="icon" variant="ghost" aria-label={t("{p0} 재시도", { p0: item.title })} disabled={work.isBusy(`retry-${item.title}`)}
                  onClick={() => void work.actions.handleRetryFailed(item.title)}><RotateCcw size={13} /></Button>
                <Button size="icon" variant="ghost" aria-label={t("{p0} 재시도 목록에서 삭제", { p0: item.title })} disabled={work.isBusy(`retry-delete-${item.title}`)}
                  onClick={() => void work.actions.handleDeleteRetryCandidate(item.title)}><X size={13} /></Button>
              </>}
            </div>}
          </div>
          {item.kind === "active" && <>
            <div className="mt-2 flex items-center gap-2">
              <div role="progressbar" aria-label={item.title || t("정리본 생성")} aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={item.indeterminate ? undefined : item.percent} className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
                <div className={`h-full rounded-full bg-[var(--brand)] transition-[width] ${item.indeterminate ? "animate-pulse" : ""}`} style={{ width: `${item.indeterminate ? Math.max(15, item.percent) : item.percent}%` }} />
              </div>
              {!item.indeterminate && <span className="text-[11px] tabular-nums">{item.percent}%</span>}
            </div>
            {item.label && <p className="mt-1.5 break-words text-[11px] text-[var(--muted-foreground)]">{item.label}</p>}
          </>}
          {item.error && <p className="mt-1.5 break-words text-[11px] text-amber-700 dark:text-amber-400">{item.error}</p>}
          {item.kind === "pending" && <p className="mt-1 text-[11px] text-[var(--muted-foreground)]"><FileText className="mr-1 inline" size={11} />{t("정리본 생성 대기")}</p>}
        </article>
      })}
    </div>
  </div>
}
