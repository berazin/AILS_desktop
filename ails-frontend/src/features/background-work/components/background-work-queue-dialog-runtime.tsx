import { t } from "../../../lib/i18n.ts"
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  Clock,
  EyeOff,
  FileSearch,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react"

import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"
import { GrammarPasswordForm } from "./grammar-password-form.tsx"
import { DocumentationTaskList, type DocumentationQueueProps } from "./documentation-task-list.tsx"
import { documentationWorkCount } from "../lib/documentation-queue.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import "./background-work-queue-dialog.css"
import {
  type BackgroundWorkQueueDetails,
  getBackgroundWorkQueue,
} from "../../../lib/api"

interface BackgroundWorkQueueDialogProps {
  open: boolean
  onClose: () => void
  onToggleOcrExclusion?: (path: string) => void
  excludedPaths?: string[]
  activeOperations?: ReactNode
  activeOperationCount?: number
  documentOperations?: ReactNode
  documentOperationCount?: number
  documentation?: DocumentationQueueProps
}

type QueueTab = "all" | "evaluating" | "ocr" | "embedding" | "spacing" | "failed"

interface UnifiedQueueItem {
  id: string
  path: string
  fileName: string
  type: "evaluating" | "ocr" | "embedding" | "spacing" | "failed"
  state: string
  reason?: string
  error?: string
  attempts?: number
  nextRetryAt?: number
}

export function BackgroundWorkQueueDialog({
  open,
  onClose,
  onToggleOcrExclusion,
  excludedPaths = [],
  activeOperations,
  activeOperationCount = 0,
  documentOperations,
  documentOperationCount = 0,
  documentation,
}: BackgroundWorkQueueDialogProps) {
  const tabId = useId()
  const [queue, setQueue] = useState<BackgroundWorkQueueDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [queueError, setQueueError] = useState("")
  const [category, setCategory] = useState<"processing" | "documentation">("processing")
  const [activeTab, setActiveTab] = useState<QueueTab>("all")
  const [searchQuery, setSearchQuery] = useState("")

  const loadQueue = useEventCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await getBackgroundWorkQueue()
      if (res?.queue) {
        setQueue(res.queue)
        setQueueError("")
      }
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!silent) setLoading(false)
    }
  })
  const selectInitialCategory = useEventCallback(() => {
    setCategory(documentationWorkCount(documentation?.status) ? "documentation" : "processing")
    setSearchQuery("")
  })
  const refreshAll = async () => {
    await loadQueue(false)
    try { await documentation?.refresh() } catch (error) { setQueueError(error instanceof Error ? error.message : String(error)) }
  }

  useEffect(() => {
    if (!open) return
    selectInitialCategory()
    void loadQueue(false)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)

    const timer = setInterval(() => {
      void loadQueue(true)
    }, 3000)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      clearInterval(timer)
    }
  }, [open, onClose, loadQueue, selectInitialCategory])

  const excludedNormSet = useMemo(() => {
    return new Set(
      excludedPaths.map((p) => p.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")),
    )
  }, [excludedPaths])

  const isExcluded = useCallback((targetPath: string) => {
    const norm = targetPath.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")
    for (const exc of excludedNormSet) {
      if (norm === exc || norm.startsWith(exc + "/")) return true
    }
    return false
  }, [excludedNormSet])

  const unifiedItems: UnifiedQueueItem[] = useMemo(() => {
    if (!queue) return []
    const items: UnifiedQueueItem[] = []

    for (const it of queue.evaluating ?? []) {
      if (isExcluded(it.path)) continue
      items.push({
        id: `eval:${it.path}`,
        path: it.path,
        fileName: it.file_name,
        type: "evaluating",
        state: it.state,
      })
    }
    for (const it of queue.ocr_pending ?? []) {
      if (isExcluded(it.path)) continue
      items.push({
        id: `ocr:${it.path}`,
        path: it.path,
        fileName: it.file_name,
        type: "ocr",
        state: it.state,
        reason: it.reason,
        attempts: it.attempts,
      })
    }
    for (const it of queue.embedding_pending ?? []) {
      items.push({
        id: `emb:${it.path}`,
        path: it.path,
        fileName: it.file_name,
        type: "embedding",
        state: it.state,
        attempts: it.attempts,
      })
    }
    for (const it of queue.ocr_failed ?? []) {
      if (isExcluded(it.path)) continue
      items.push({
        id: `fail:${it.path}`,
        path: it.path,
        fileName: it.file_name,
        type: "failed",
        state: it.state,
        error: it.error,
        attempts: it.attempts,
        nextRetryAt: it.next_retry_at,
      })
    }
    for (const it of queue.spacing_pending ?? []) {
      if (isExcluded(it.path)) continue
      items.push({ id: `spacing:${it.path}`, path: it.path, fileName: it.file_name,
        type: it.state === "failed" ? "failed" : "spacing", state: it.state,
        error: it.error, attempts: it.attempts, nextRetryAt: it.next_retry_at, reason: t("문법정제") + (it.progress ? ` ${it.progress.page}/${it.progress.total}쪽` : "") })
    }
    return items
  }, [queue, isExcluded])

  const filteredItems = useMemo(() => {
    let result = unifiedItems
    if (activeTab === "evaluating") {
      result = result.filter((it) => it.type === "evaluating")
    } else if (activeTab === "ocr") {
      result = result.filter((it) => it.type === "ocr")
    } else if (activeTab === "embedding") {
      result = result.filter((it) => it.type === "embedding")
    } else if (activeTab === "spacing") {
      result = result.filter((it) => it.type === "spacing")
    } else if (activeTab === "failed") {
      result = result.filter((it) => it.type === "failed")
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (it) =>
          it.fileName.toLowerCase().includes(q) ||
          it.path.toLowerCase().includes(q) ||
          (it.reason && it.reason.toLowerCase().includes(q)) ||
          (it.error && it.error.toLowerCase().includes(q)),
      )
    }
    return result
  }, [unifiedItems, activeTab, searchQuery])

  if (!open) return null

  const evalCount = unifiedItems.filter((it) => it.type === "evaluating").length
  const ocrCount = unifiedItems.filter((it) => it.type === "ocr").length
  const spacingCount = unifiedItems.filter((it) => it.type === "spacing").length
  const embCount = unifiedItems.filter((it) => it.type === "embedding").length
  const failedCount = unifiedItems.filter((it) => it.type === "failed").length
  const processingCount = unifiedItems.length - failedCount + documentOperationCount
  const documentationCount = documentationWorkCount(documentation?.status)
  const totalWaiting = processingCount + documentationCount + activeOperationCount

  return (
    <div
      data-ails-background-work-queue
      className="fixed inset-0 z-[105] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("백그라운드 작업 대기 목록")}
        className="flex max-h-[85vh] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Clock className="text-[var(--brand)]" size={18} />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">
                  {t("백그라운드 작업 대기 목록")}
                </h2>
                <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs font-semibold text-[var(--muted-foreground)]">
                  {totalWaiting}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              aria-label={t("새로고침")}
              className="h-8 w-8"
              disabled={loading}
              onClick={() => void refreshAll()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <RefreshCw className={loading ? "animate-spin" : ""} size={14} />
            </Button>
            <Button
              aria-label={t("닫기")}
              className="h-8 w-8"
              onClick={onClose}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X size={16} />
            </Button>
          </div>
        </header>

        {activeOperations}
        <div role="tablist" aria-label={t("작업 분류")} className="flex shrink-0 gap-1 border-b border-[var(--border)] px-4 pt-3">
          {([{ id: "processing", label: t("문서처리"), count: processingCount }, { id: "documentation", label: t("문서화"), count: documentationCount }] as const).map(tab => <button
            key={tab.id} type="button" role="tab" id={`${tabId}-${tab.id}`} aria-selected={category === tab.id} aria-controls={`${tabId}-panel`}
            tabIndex={category === tab.id ? 0 : -1}
            data-work-category={tab.id} onClick={() => setCategory(tab.id)}
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
              event.preventDefault()
              const next = event.key === "Home" ? "processing" : event.key === "End" ? "documentation" : category === "processing" ? "documentation" : "processing"
              setCategory(next)
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-work-category="${next}"]`)?.focus()
            }}
            className={`flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2.5 text-xs font-semibold ${category === tab.id ? "border-[var(--brand)] text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}>
            {tab.label}<span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] tabular-nums">{tab.count}</span>
          </button>)}
        </div>
        {queueError && <p role="alert" className="shrink-0 border-b border-[var(--border)] px-5 py-2 text-xs text-amber-700 dark:text-amber-400">{t("작업 목록을 불러오지 못했습니다.")} {queueError}</p>}
        <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${category}`} className="flex min-h-0 flex-1 flex-col">
        {category === "documentation" ? <DocumentationTaskList work={documentation} searchQuery={searchQuery} onSearchChange={setSearchQuery} /> : <>
        {documentOperations}
        {/* Current Processing Banner */}
        {queue?.current_ocr && (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-2.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="shrink-0 font-semibold text-amber-700 dark:text-amber-400">
                  {t("현재 처리 중")} (OCR)
                </span>
                <span className="truncate font-medium text-[var(--foreground)]" title={queue.current_ocr.path}>
                  {queue.current_ocr.file_name || queue.current_ocr.path.split(/[\\/]/).pop()}
                </span>
              </div>
              {queue.current_ocr.total > 0 && (
                <span className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 font-semibold text-amber-800 dark:text-amber-300">
                  {queue.current_ocr.page} / {queue.current_ocr.total}쪽
                </span>
              )}
            </div>
          </div>
        )}

        {/* Controls: Tabs & Search */}
        <div className="space-y-3 border-b border-[var(--border)] p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeTab === "all"
                  ? "bg-[var(--brand)] text-white"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setActiveTab("all")}
              type="button"
            >
              {t("전체 ({p0})", { p0: unifiedItems.length })}
            </button>
            <button type="button" onClick={() => setActiveTab("spacing")}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${activeTab === "spacing" ? "bg-[var(--brand)] text-white" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}>
              {t("문법정제 ({p0})", { p0: spacingCount })}
            </button>
            <button
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeTab === "evaluating"
                  ? "bg-blue-600 text-white"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setActiveTab("evaluating")}
              type="button"
            >
              {t("판정 대기 ({p0})", { p0: evalCount })}
            </button>
            <button
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeTab === "ocr"
                  ? "bg-amber-600 text-white"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setActiveTab("ocr")}
              type="button"
            >
              {t("OCR 대기 ({p0})", { p0: ocrCount })}
            </button>
            <button
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeTab === "embedding"
                  ? "bg-purple-600 text-white"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setActiveTab("embedding")}
              type="button"
            >
              {t("임베딩 대기 ({p0})", { p0: embCount })}
            </button>
            <button
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeTab === "failed"
                  ? "bg-red-600 text-white"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setActiveTab("failed")}
              type="button"
            >
              {t("실패 ({p0})", { p0: failedCount })}
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" size={14} />
            <Input
              className="h-8 pl-8 pr-3 text-xs"
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t("문서 검색")}
              placeholder={t("문서 검색")}
              value={searchQuery}
            />
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-[var(--border)]">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--muted-foreground)]">
              {searchQuery ? t("검색 결과가 없습니다.") : t("대기 중인 문서가 없습니다.")}
            </div>
          ) : (
            filteredItems.map((item) => {
              const excluded = isExcluded(item.path)
              return (
                <div
                  className="flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--muted)]/50 transition-colors rounded-md"
                  key={item.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {item.type === "failed" ? (
                        <AlertTriangle className="shrink-0 text-red-500" size={13} />
                      ) : item.type === "embedding" ? (
                        <Sparkles className="shrink-0 text-purple-500" size={13} />
                      ) : item.type === "ocr" ? (
                        <FileText className="shrink-0 text-amber-500" size={13} />
                      ) : (
                        <FileSearch className="shrink-0 text-blue-500" size={13} />
                      )}
                      <span className="truncate text-xs font-medium text-[var(--foreground)]" title={item.path}>
                        {item.fileName}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--muted-foreground)]" title={item.path}>
                      {item.path}
                    </div>
                    {item.reason && (
                      <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                        {item.reason}
                      </div>
                    )}
                    {item.error && (
                      <div className={`mt-0.5 text-[10px] ${item.state === "password_required" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`} title={item.error}>
                        {item.error}
                      </div>
                    )}
                    {item.state === "password_required" && (
                      <GrammarPasswordForm path={item.path} onSubmitted={() => { void loadQueue(true) }} />
                    )}
                    {item.type === "failed" && item.attempts != null && item.attempts > 0 && (
                      <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                        {t("시도 {p0}회", { p0: item.attempts })}
                        {(item.state === "blocked" || item.state === "pending") && item.nextRetryAt != null && item.nextRetryAt > 0
                          ? ` · ${t("재시도 예정")}`
                          : ""}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {excluded ? (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                        {t("OCR 제외")}
                      </span>
                    ) : onToggleOcrExclusion ? (
                      <button
                        className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-amber-600 transition-colors"
                        onClick={() => onToggleOcrExclusion(item.path)}
                        title={t("OCR 제외")}
                        type="button"
                      >
                        <EyeOff size={11} className="inline mr-1" />
                        {t("OCR 제외")}
                      </button>
                    ) : null}

                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                        item.type === "failed"
                          ? "bg-red-500/15 text-red-700 dark:text-red-400"
                          : item.type === "evaluating"
                          ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                          : item.type === "ocr"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                      }`}
                    >
                      {item.state === "password_required"
                        ? t("비밀번호 입력 대기")
                        : item.type === "failed"
                        ? item.state === "blocked"
                          ? t("재시도 대기")
                          : t("실패")
                        : item.type === "evaluating"
                        ? t("판정 대기")
                        : item.type === "ocr"
                        ? t("OCR 대기")
                        : item.type === "spacing"
                        ? item.nextRetryAt && item.nextRetryAt > 0 ? t("재시도 대기") : t("문법정제")
                        : t("임베딩 대기")}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        </>}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted-foreground)]">
          <span>{t("열려 있는 동안 자동으로 갱신됩니다.")}</span>
          <Button onClick={onClose} size="sm" type="button" variant="outline">
            {t("닫기")}
          </Button>
        </footer>
      </section>
    </div>
  )
}
