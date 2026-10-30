import type { Dispatch, SetStateAction } from "react"
import {
  BookOpen,
  Bot,
  ClipboardList,
  ExternalLink,
  FileAudio2,
  FileText,
  FileVideo2,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react"

import {
  SUMMARY_AUDIO_PDF_ENABLED,
  SUMMARY_GENERATION_ENABLED,
  SUMMARY_LOCAL_STT_ENABLED,
  SUMMARY_MEDIA_FILES_ENABLED,
  SUMMARY_WEB_INPUTS_ENABLED,
} from "../../../edition.ts"
import type {
  ActiveTaskStatus,
  AILSStatus,
  PendingTask,
  RetryCandidate,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { titleFromPath } from "../../../lib/viewer-document.ts"
import { cn } from "../../../lib/utils.ts"
import type {
  SummaryGenerationWorkflow,
  SummaryTaskTab,
} from "../hooks/use-summary-generation-workflow.ts"
import { Badge } from "../../../shared/ui/badge.tsx"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"
import { Textarea } from "../../../shared/ui/textarea.tsx"

const SUMMARY_CREATION_LABEL_ENABLED = SUMMARY_AUDIO_PDF_ENABLED || SUMMARY_WEB_INPUTS_ENABLED

const taskTabs: Array<{ id: SummaryTaskTab; label: string; icon: typeof FileText }> = [
  /* @ails-feature:summary.web_inputs:start */
  { id: "url", label: t("URL 패턴"), icon: ClipboardList },
  { id: "youtube", label: "YouTube", icon: ExternalLink },
  { id: "eclass", label: "e-class VOD", icon: BookOpen },
  { id: "lms-scan", label: t("LMS 일괄 스마트 분석"), icon: RefreshCw },
  /* @ails-feature:summary.web_inputs:end */
  {
    id: "media",
    label: SUMMARY_MEDIA_FILES_ENABLED
      ? (SUMMARY_AUDIO_PDF_ENABLED ? t("오디오 · 영상 · PDF") : t("영상"))
      : t("오디오 & PDF"),
    icon: Upload,
  },
  { id: "markdown", label: t("MD 업로드"), icon: Upload },
]

type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
) => Promise<void>

type SummaryGenerationActivity = {
  activeTasks: ActiveTaskStatus[]
  currentProgress: number
  currentProgressLabel: string
  currentStatus?: AILSStatus | null
  generationNotices: string[]
  handleCancelAllTasks: () => Promise<void>
  handleCancelCurrent: () => Promise<void>
  handleCancelPending: (taskId: number) => Promise<void>
  handleCancelTask: (taskId: number) => Promise<void>
  handleDeleteRetryCandidate: (title: string) => Promise<void>
  handlePauseCurrent: () => Promise<void>
  handlePauseTask: (taskId: number) => Promise<void>
  handleResumeCurrent: () => Promise<void>
  handleResumeTask: (taskId: number) => Promise<void>
  handleRetryAllFailed: () => Promise<void>
  handleRetryFailed: (title: string) => Promise<void>
  refresh: () => Promise<unknown>
  pending: PendingTask[]
  retryCandidates: RetryCandidate[]
  runInteraction: RunInteraction
  setGenerationNotices: Dispatch<SetStateAction<string[]>>
}

type SummaryGenerationDialogProps = {
  activity: SummaryGenerationActivity
  isBusy: (key: string) => boolean
  onDeviceReauthenticate: (title: string) => void
  workflow: SummaryGenerationWorkflow
}

function isDeviceInactiveError(error: string | undefined) {
  const message = String(error || "").toLocaleLowerCase()
  return message.includes("device is not active") || message.includes("장치의 인증이 유효하지")
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function SummaryGenerationDialog({
  activity,
  isBusy,
  onDeviceReauthenticate,
  workflow,
}: SummaryGenerationDialogProps) {
  const {
    actions: {
      /* @ails-feature:summary.web_inputs:start */
      cancelLmsAuthentication: handleCancelLmsAuthentication,
      /* @ails-feature:summary.web_inputs:end */
      importMarkdownDocument: handleMarkdownImport,
      notify: setNotice,
      /* @ails-feature:summary.web_inputs:start */
      openLmsLogin: handleOpenLmsLogin,
      /* @ails-feature:summary.web_inputs:end */
      pickAudioFiles: handlePickAudioFiles,
      pickMarkdownFile: handlePickMarkdownFile,
      pickPdfFile: handlePickPdfFile,
      pickVideoFile: handlePickVideoFile,
      selectTab,
      setOpen: setLectureAddExpanded,
      /* @ails-feature:summary.audio_pdf:start */
      submitAudio: handleAudioSubmit,
      /* @ails-feature:summary.audio_pdf:end */
      /* @ails-feature:summary.web_inputs:start */
      submitEclass: handleEclassSubmit,
      /* @ails-feature:summary.web_inputs:end */
      /* @ails-feature:summary.web_inputs:start */
      submitLmsScan: handleLmsScanSubmit,
      /* @ails-feature:summary.web_inputs:end */
      /* @ails-feature:summary.web_inputs:start */
      submitUrl: handleUrlSubmit,
      /* @ails-feature:summary.web_inputs:end */
      submitVideo: handleVideoSubmit,
      /* @ails-feature:summary.web_inputs:start */
      submitYoutube: handleYoutubeSubmit,
      /* @ails-feature:summary.web_inputs:end */
      updateUrl: handleUrlChange,
    },
    forms: {
      audio: audioForm,
      eclass: eclassForm,
      lms: lmsForm,
      markdown: mdForm,
      setAudio: setAudioForm,
      setEclass: setEclassForm,
      setLms: setLmsForm,
      setMarkdown: setMdForm,
      setUrl: setUrlForm,
      setVideo: setVideoForm,
      setYoutube: setYoutubeForm,
      url: urlForm,
      video: videoForm,
      youtube: youtubeForm,
    },
    state: {
      activeTab,
      open: lectureAddExpanded,
      lmsAuthStatus,
      lmsAuthError,
      lmsCancelPending,
      lmsSubmitPending,
    },
  } = workflow
  const {
    activeTasks,
    currentProgress,
    currentProgressLabel,
    currentStatus,
    generationNotices,
    handleCancelAllTasks,
    handleCancelCurrent,
    handleCancelPending,
    handleCancelTask,
    handleDeleteRetryCandidate,
    handlePauseCurrent,
    handlePauseTask,
    handleResumeCurrent,
    handleResumeTask,
    handleRetryAllFailed,
    handleRetryFailed,
    pending,
    refresh,
    retryCandidates,
    runInteraction,
    setGenerationNotices,
  } = activity

  return (
    <>
{lectureAddExpanded && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
    <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3 shrink-0 bg-[var(--sidebar)]/20">
        <div className="flex min-w-0 items-center gap-3">
          <Bot size={18} className="shrink-0 text-[var(--brand)] animate-pulse" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">
              {SUMMARY_CREATION_LABEL_ENABLED ? t("정리본 생성 (새 강의 추가)") : t("학습 자료 추가")}
            </h1>
            <p className="text-xs text-[var(--muted-foreground)]">
              {SUMMARY_CREATION_LABEL_ENABLED
                ? t("입력 유형을 고르고 정리본 생성 작업을 등록합니다.")
                : SUMMARY_MEDIA_FILES_ENABLED
                  ? t("영상 파일을 골라 상세 정리 또는 요약 정리 작업을 등록합니다.")
                : t("기존 Markdown 정리본을 등록합니다.")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setLectureAddExpanded(false)} type="button">
            <X size={18} />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[var(--background)]">
        {/* @ails-feature:summary.web_inputs:start */}
        {lmsSubmitPending && (lmsAuthStatus || lmsAuthError) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-3 text-sm" role="status" aria-live="polite">
            <div className="flex items-start gap-2">
              <Loader2 className="mt-0.5 shrink-0 animate-spin" size={16} />
              <div>
                <p className="font-medium">
                  {lmsAuthStatus?.state === "awaiting_mfa"
                    ? t("브라우저에서 추가 인증을 완료하세요. 완료되면 작업이 자동으로 이어집니다.")
                    : t("LMS 로그인 상태를 확인하는 중입니다.")}
                </p>
                {lmsAuthStatus?.message && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{lmsAuthStatus.message}</p>}
                {lmsAuthError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t("인증 상태 확인 실패: {p0}", { p0: lmsAuthError })}</p>}
              </div>
            </div>
            {lmsAuthStatus?.attempt_id && (
              <div className="flex flex-col items-end gap-1">
                <Button disabled={lmsCancelPending} onClick={() => void handleCancelLmsAuthentication()} type="button" variant="outline">
                  {t("인증 대기 취소")}
                </Button>
                <p className="text-xs text-[var(--muted-foreground)]">{t("같은 인증을 기다리는 모든 요청이 취소됩니다.")}</p>
              </div>
            )}
          </div>
        )}
        {/* @ails-feature:summary.web_inputs:end */}
        {generationNotices.length > 0 && (
          <div className="rounded-xl border border-red-200/50 bg-red-500/5 p-4 text-xs text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-300">
            <div className="flex items-center justify-between font-bold mb-2">
              <span className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-red-500" />
                {t("최근 알림 (")}{generationNotices.length}{t("개)")}</span>
              <button
                onClick={() => {
                  setNotice("")
                  setGenerationNotices([])
                }}
                className="hover:underline font-medium text-[var(--brand)] text-[10px]"
              >
                {t("모든 알림 지우기")}</button>
            </div>
            <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
              {generationNotices.map((msg, index) => (
                <li key={index} className="flex items-start gap-1">
                  <span className="shrink-0">?</span>
                  <span>{msg}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[10px] text-red-600/70 dark:text-red-400/50">
              {t("* 알림은 모달이 활성화된 뒤 4초가 지나면 자동으로 비워집니다.")}</div>
          </div>
        )}
        {/* @ails-summary-generation:start */}
        {SUMMARY_GENERATION_ENABLED && (
          <section
            className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm"
            data-summary-task-status="true"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{t("작업 현황")}</h2>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>{t("진행 ")}{activeTasks.length || (currentStatus?.is_running ? 1 : 0)}</span>
                  <span>·</span>
                  <span>{t("대기 ")}{pending.length}</span>
                  <span>·</span>
                  <span>{t("재시도 ")}{retryCandidates.length}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {activeTasks.length > 1 && (
                  <Button disabled={isBusy("cancel-all")} onClick={() => void handleCancelAllTasks()} size="sm" variant="ghost">
                    <X size={13} /> {t("전체 취소")}</Button>
                )}
                <Button
                  aria-label={t("작업 현황 새로고침")}
                  disabled={isBusy("generation-status-refresh")}
                  onClick={() => void runInteraction("generation-status-refresh", t("작업 현황 새로고침"), async () => {
                    await refresh()
                    return t("작업 현황을 새로고침했습니다.")
                  })}
                  size="sm"
                  variant="ghost"
                >
                  <RefreshCw className={cn(isBusy("generation-status-refresh") && "animate-spin")} size={14} />
                  {t("새로고침")}</Button>
              </div>
            </div>

            {(activeTasks.length > 0 || currentStatus?.is_running) && <div className="mt-4 space-y-2">
              {activeTasks.map((task: ActiveTaskStatus) => {
                const percent = clamp(Number(task.progress_percent ?? 0), 0, 100)
                const label = task.progress_label?.trim() || t("진행 중")
                return (
                  <div className="rounded-xl bg-[var(--muted)]/55 px-3 py-2.5" key={task.task_id}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{task.title}</span>
                      <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{percent}%</span>
                      <Button
                        aria-label={task.is_paused ? t("{p0} 재개", { p0: task.title }) : t("{p0} 일시정지", { p0: task.title })}
                        disabled={isBusy(`${task.is_paused ? "resume" : "pause"}-task-${task.task_id}`)}
                        onClick={() => void (task.is_paused ? handleResumeTask(task.task_id) : handlePauseTask(task.task_id))}
                        size="icon"
                        variant="ghost"
                      >
                        {task.is_paused ? <Play size={13} /> : <Pause size={13} />}
                      </Button>
                      <Button
                        aria-label={t("{p0} 취소", { p0: task.title })}
                        disabled={isBusy(`cancel-task-${task.task_id}`)}
                        onClick={() => void handleCancelTask(task.task_id)}
                        size="icon"
                        variant="ghost"
                      >
                        <X size={13} />
                      </Button>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--background)]">
                      <div
                        className={cn("h-full rounded-full bg-[var(--brand)] transition-[width] duration-500", task.progress_indeterminate && "animate-pulse")}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="mt-1 truncate text-[11px] text-[var(--muted-foreground)]">
                      {task.cancel_requested ? t("취소 요청됨") : task.is_paused ? t("일시정지됨") : label}
                    </div>
                  </div>
                )
              })}
              {activeTasks.length === 0 && currentStatus?.is_running && (
                <div className="rounded-xl bg-[var(--muted)]/55 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{currentStatus.current_title || t("정리본 생성")}</span>
                    <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{currentProgress}%</span>
                    {currentStatus.is_paused ? (
                      <Button aria-label={t("작업 재개")} disabled={isBusy("resume-current")} onClick={() => void handleResumeCurrent()} size="icon" variant="ghost"><Play size={13} /></Button>
                    ) : (
                      <Button aria-label={t("작업 일시정지")} disabled={isBusy("pause-current")} onClick={() => void handlePauseCurrent()} size="icon" variant="ghost"><Pause size={13} /></Button>
                    )}
                    <Button aria-label={t("작업 취소")} disabled={isBusy("cancel-current")} onClick={() => void handleCancelCurrent()} size="icon" variant="ghost"><X size={13} /></Button>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--background)]">
                    <div
                      className={cn("h-full rounded-full bg-[var(--brand)] transition-[width] duration-500", currentStatus.progress_indeterminate && "animate-pulse")}
                      style={{ width: `${currentProgress}%` }}
                    />
                  </div>
                  <div className="mt-1 truncate text-[11px] text-[var(--muted-foreground)]">
                    {currentStatus.cancel_requested ? t("취소 요청됨") : currentStatus.is_paused ? t("일시정지됨") : currentProgressLabel}
                  </div>
                </div>
              )}
            </div>}

            {(pending.length > 0 || retryCandidates.length > 0) && <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold">{t("대기열")}</h3>
                  <Badge>{pending.length}</Badge>
                </div>
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {pending.length === 0 ? (
                    <div className="py-3 text-center text-xs text-[var(--muted-foreground)]">{t("대기 작업 없음")}</div>
                  ) : pending.map((item) => (
                    <div className="flex items-center gap-2 rounded-lg bg-[var(--muted)]/50 px-2 py-1.5" key={item.id}>
                      <span className="min-w-0 flex-1 truncate text-xs">{item.title}</span>
                      <Button
                        aria-label={t("{p0} 대기열에서 삭제", { p0: item.title })}
                        disabled={isBusy(`cancel-pending-${item.id}`)}
                        onClick={() => void handleCancelPending(item.id)}
                        size="icon"
                        variant="ghost"
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold">{t("재시도")}</h3>
                  <Button
                    disabled={retryCandidates.length === 0 || isBusy("retry-all")}
                    onClick={() => void handleRetryAllFailed()}
                    size="sm"
                    variant="ghost"
                  >
                    <RotateCcw size={12} /> {t("전체")}</Button>
                </div>
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {retryCandidates.length === 0 ? (
                    <div className="py-3 text-center text-xs text-[var(--muted-foreground)]">{t("실패 작업 없음")}</div>
                  ) : retryCandidates.map((item) => (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--muted)]/50 px-2 py-1.5" key={item.title}>
                      <span className="min-w-0 flex-1 truncate text-xs" title={item.last_error || item.title}>
                        {item.title}{item.status === "needs_review" ? ` · ${t("확인 필요")}` : ""}
                      </span>
                      {isDeviceInactiveError(item.last_error) && !item.active && (
                        <>
                          <span className="w-full text-xs text-amber-600 dark:text-amber-400">{t("장치 인증이 유효하지 않습니다. AILS 계정에 다시 로그인해 주세요.")}</span>
                          <Button size="sm" variant="outline" onClick={() => onDeviceReauthenticate(item.title)}>{t("다시 로그인")}</Button>
                        </>
                      )}
                      <Button
                        aria-label={t("{p0} 재시도", { p0: item.title })}
                        disabled={item.active || isBusy(`retry-${item.title}`)}
                        onClick={() => void handleRetryFailed(item.title)}
                        size="icon"
                        variant="ghost"
                      >
                        <RotateCcw size={12} />
                      </Button>
                      <Button
                        aria-label={t("{p0} 재시도 목록에서 삭제", { p0: item.title })}
                        disabled={item.active || isBusy(`retry-delete-${item.title}`)}
                        onClick={() => void handleDeleteRetryCandidate(item.title)}
                        size="icon"
                        variant="ghost"
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>}
          </section>
        )}
        {/* @ails-summary-generation:end */}
        <div className="ails-collapsible-panel">
          <div className="mb-4 flex flex-wrap gap-2">
            {taskTabs.filter((tab) => tab.id !== "media" || SUMMARY_MEDIA_FILES_ENABLED || SUMMARY_AUDIO_PDF_ENABLED).map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                    activeTab === tab.id
                      ? "bg-[var(--muted)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
                  )}
                  key={tab.id}
                  onClick={() => selectTab(tab.id, tab.label)}
                  type="button"
                >
                  <Icon size={15} /> {tab.label}
                </button>
              )
            })}
          </div>

          {/* @ails-summary-generation:start */}
          {/* @ails-feature:summary.web_inputs:start */}
          {activeTab === "url" && (
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
              <label className="text-sm font-medium">
                {t("URL 패턴")}<Input
                  className="mt-2"
                  onChange={(event) => handleUrlChange(event.target.value)}
                  placeholder="https://example.com/segment-001.ts"
                  value={urlForm.url}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_2fr]">
                <label className="text-sm font-medium">
                  {t("시작")}<Input
                    className="mt-2"
                    onChange={(event) => setUrlForm({ ...urlForm, start: event.target.value })}
                    value={urlForm.start}
                  />
                </label>
                <label className="text-sm font-medium">
                  {t("종료")}<Input
                    className="mt-2"
                    onChange={(event) => setUrlForm({ ...urlForm, end: event.target.value })}
                    value={urlForm.end}
                  />
                </label>
                <label className="text-sm font-medium">
                  {t("제목")}<Input
                    className="mt-2"
                    onChange={(event) => setUrlForm({ ...urlForm, title: event.target.value })}
                    placeholder={t("컴퓨터구조 10주차 1")}
                    value={urlForm.title}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={urlForm.detailMode === "detailed"} onChange={() => setUrlForm({ ...urlForm, detailMode: "detailed" })} />
                  {t("상세 정리")}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={urlForm.detailMode === "summary"} onChange={() => setUrlForm({ ...urlForm, detailMode: "summary" })} />
                  {t("요약 정리")}
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-sm text-[var(--muted-foreground)]">
                  <label className="flex items-center gap-2">
                    <input
                      checked={urlForm.sttOnly}
                      onChange={(event) => {
                        setUrlForm({ ...urlForm, sttOnly: event.target.checked })
                        setNotice(event.target.checked ? t("요약 생략 옵션을 켰습니다.") : t("요약 생략 옵션을 껐습니다."))
                      }}
                      type="checkbox"
                    />
                    {t("요약 생략(STT만)")}</label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={urlForm.mp3Only}
                      onChange={(event) => {
                        setUrlForm({ ...urlForm, mp3Only: event.target.checked })
                        setNotice(event.target.checked ? t("STT 생략 옵션을 켰습니다.") : t("STT 생략 옵션을 껐습니다."))
                      }}
                      type="checkbox"
                    />
                    {t("STT 생략(MP3만)")}</label>
                </div>
                <Button disabled={isBusy("url-submit")} onClick={() => {
                  void handleUrlSubmit()
                  setLectureAddExpanded(false)
                }}>
                  {isBusy("url-submit") ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  {t("URL 작업 추가")}</Button>
              </div>
            </div>
          )}

          {activeTab === "youtube" && (
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
              <label className="text-sm font-medium">
                YouTube URL
                <Input
                  className="mt-2"
                  onChange={(event) => setYoutubeForm({ ...youtubeForm, url: event.target.value })}
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeForm.url}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
                <label className="text-sm font-medium">
                  {t("제목")}<Input
                    className="mt-2"
                    onChange={(event) => setYoutubeForm({ ...youtubeForm, title: event.target.value })}
                    placeholder={t("자료구조")}
                    value={youtubeForm.title}
                  />
                </label>
                <label className="text-sm font-medium">
                  {t("프레임 간격(초)")}<Input
                    className="mt-2"
                    min="1"
                    onChange={(event) => setYoutubeForm({ ...youtubeForm, frameInterval: event.target.value })}
                    type="number"
                    value={youtubeForm.frameInterval}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={youtubeForm.detailMode === "detailed"} onChange={() => setYoutubeForm({ ...youtubeForm, detailMode: "detailed" })} />
                  {t("상세 정리")}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={youtubeForm.detailMode === "summary"} onChange={() => setYoutubeForm({ ...youtubeForm, detailMode: "summary" })} />
                  {t("요약 정리")}
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-sm text-[var(--muted-foreground)]">
                  <label className="flex items-center gap-2">
                    <input
                      checked={youtubeForm.sttOnly}
                      onChange={(event) => setYoutubeForm({ ...youtubeForm, sttOnly: event.target.checked })}
                      type="checkbox"
                    />
                    {t("요약 생략(STT만)")}</label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={youtubeForm.mp3Only}
                      onChange={(event) => setYoutubeForm({ ...youtubeForm, mp3Only: event.target.checked })}
                      type="checkbox"
                    />
                    {t("STT 생략(MP3만)")}</label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={youtubeForm.skipImages}
                      onChange={(event) => setYoutubeForm({ ...youtubeForm, skipImages: event.target.checked })}
                      type="checkbox"
                    />
                    {t("화면 분석 생략")}</label>
                </div>
                <Button disabled={isBusy("youtube-submit")} onClick={() => {
                  void handleYoutubeSubmit()
                  setLectureAddExpanded(false)
                }}>
                  {isBusy("youtube-submit") ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  {t("YouTube 작업 추가")}</Button>
              </div>
            </div>
          )}

          {activeTab === "eclass" && (
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
              <label className="text-sm font-medium">
                e-class VOD URL
                <Input
                  className="mt-2"
                  onChange={(event) => setEclassForm({ ...eclassForm, url: event.target.value })}
                  placeholder="https://lms.example.edu/mod/vod/view.php?id=123"
                  value={eclassForm.url}
                />
              </label>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
                <label className="text-sm font-medium">
                  {t("제목")}<Input
                    className="mt-2"
                    onChange={(event) => setEclassForm({ ...eclassForm, title: event.target.value })}
                    placeholder={t("컴퓨터구조 10주차1")}
                    value={eclassForm.title}
                  />
                </label>
                {SUMMARY_LOCAL_STT_ENABLED && (
                  <label className="flex items-start gap-2 rounded-lg border border-[var(--border)] p-3 text-sm">
                    <input
                      aria-label={t("로컬 STT 사용")}
                      checked={eclassForm.localStt}
                      className="mt-0.5"
                      onChange={(event) => setEclassForm({ ...eclassForm, localStt: event.target.checked })}
                      type="checkbox"
                    />
                    <span>
                      <span className="block font-medium">{t("로컬 STT 사용")}</span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
                        {t("Vulkan GPU에서 Whisper를 실행합니다. NVIDIA·AMD·Intel GPU를 지원하고 PC 메모리에 맞춰 Tiny부터 Large-v3-turbo Q5 중 자동 선택하며, 실패해도 CPU나 클라우드 STT로 자동 전환하지 않습니다.")}</span>
                    </span>
                  </label>
                )}
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-xs text-[var(--muted-foreground)]">
                {t("e-class VOD 작업에는 AILS 전용 Edge 창을 사용합니다. 추가 인증이 필요하면 열린 창에서 완료하세요. 인증 후 작업이 자동으로 이어집니다.")}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-sm text-[var(--muted-foreground)]">
                  <label className="flex items-center gap-2">
                    <input
                      checked={eclassForm.sttOnly}
                      onChange={(event) => setEclassForm({ ...eclassForm, sttOnly: event.target.checked })}
                      type="checkbox"
                    />
                    {t("요약 생략(STT만)")}</label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={eclassForm.mp3Only}
                      onChange={(event) => setEclassForm({ ...eclassForm, mp3Only: event.target.checked })}
                      type="checkbox"
                    />
                    {t("STT 생략(MP3만)")}</label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={eclassForm.skipImages}
                      onChange={(event) => setEclassForm({ ...eclassForm, skipImages: event.target.checked })}
                      type="checkbox"
                    />
                    {t("화면 분석 생략")}</label>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={eclassForm.detailMode === "detailed"}
                      onChange={() => setEclassForm({ ...eclassForm, detailMode: "detailed" })}
                    />
                    {t("상세 정리")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={eclassForm.detailMode === "summary"}
                      onChange={() => setEclassForm({ ...eclassForm, detailMode: "summary" })}
                    />
                    {t("요약 정리")}
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={lmsSubmitPending || isBusy("lms-login")} onClick={() => void handleOpenLmsLogin()}>
                    {isBusy("lms-login") ? <Loader2 className="animate-spin" size={16} /> : <ExternalLink size={16} />}
                    {t("LMS 창 열기")}</Button>
                  <Button disabled={lmsSubmitPending || isBusy("eclass-submit")} onClick={() => void handleEclassSubmit()}>
                    {isBusy("eclass-submit") ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                    {t("e-class VOD 작업 추가")}</Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "lms-scan" && (
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
              <div className="flex justify-end">
                <Button variant="outline" disabled={lmsSubmitPending || isBusy("lms-login")} onClick={() => void handleOpenLmsLogin()}>
                  {isBusy("lms-login") ? <Loader2 className="animate-spin" size={16} /> : <ExternalLink size={16} />}
                  {t("LMS 창 열기")}</Button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className="md:col-span-3">
                  <label className="text-sm font-medium">
                    {t("LMS 홈 / 대시보드 링크")}<Input
                      className="mt-2"
                      onChange={(event) => setLmsForm({ ...lmsForm, url: event.target.value })}
                      placeholder={t("https://lms.example.edu/ (또는 특정 과목 홈 링크)")}
                      value={lmsForm.url}
                    />
                  </label>
                </div>
                <label className="text-sm font-medium">
                  {t("대상 학년")}<select
                    className="mt-2 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                    onChange={(event) => setLmsForm({ ...lmsForm, grade: Number(event.target.value) })}
                    value={lmsForm.grade}
                  >
                    {[1, 2, 3, 4, 5, 6].map((grade) => <option key={grade} value={grade}>{grade}{t("학년")}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  {t("대상 학기")}<select
                    className="mt-2 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                    onChange={(event) => setLmsForm({ ...lmsForm, semester: Number(event.target.value) })}
                    value={lmsForm.semester}
                  >
                    <option value={1}>{t("1학기")}</option>
                    <option value={2}>{t("2학기")}</option>
                  </select>
                </label>
                <div>
                  <label className="text-sm font-medium">
                    {t("시작 주차 필터")}<Input
                      className="mt-2"
                      type="number"
                      min={1}
                      onChange={(event) => setLmsForm({ ...lmsForm, startWeek: Math.max(1, parseInt(event.target.value) || 1) })}
                      value={lmsForm.startWeek}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-xs text-[var(--muted-foreground)] leading-relaxed">
                {t("LMS 대시보드 또는 특정 과목 링크를 입력하면 전체 수강 과목을 조회하고, 선택한 학년·학기 폴더를 기준으로 누락된 차시 VOD와 일반 강의 자료(PDF, PPT, PPTX 등)를 가져옵니다.")}
                <br />
                {t("설정에 LMS 계정을 저장하면 AILS가 전용 Edge 창에서 자동 로그인을 시도합니다. 추가 인증이 필요하면 열린 창에서 완료하세요. 인증 후 분석이 자동으로 이어집니다.")}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-sm text-[var(--muted-foreground)]">
                  <label className="flex items-center gap-2">
                    <input
                      checked={lmsForm.sttOnly}
                      onChange={(event) => setLmsForm({ ...lmsForm, sttOnly: event.target.checked })}
                      type="checkbox"
                    />
                    {t("요약 생략(STT만)")}</label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={lmsForm.mp3Only}
                      onChange={(event) => setLmsForm({ ...lmsForm, mp3Only: event.target.checked })}
                      type="checkbox"
                    />
                    {t("STT 생략(MP3만)")}</label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={lmsForm.skipImages}
                      onChange={(event) => setLmsForm({ ...lmsForm, skipImages: event.target.checked })}
                      type="checkbox"
                    />
                    {t("화면 분석 생략")}</label>
                  {SUMMARY_LOCAL_STT_ENABLED && (
                    <label className="flex items-start gap-2 rounded-lg border border-[var(--border)] p-3 text-sm">
                      <input
                        aria-label={t("로컬 STT 사용")}
                        checked={lmsForm.localStt}
                        className="mt-0.5"
                        onChange={(event) => setLmsForm({ ...lmsForm, localStt: event.target.checked })}
                        type="checkbox"
                      />
                      <span>
                        <span className="block font-medium">{t("로컬 STT 사용")}</span>
                        <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
                          {t("Vulkan GPU에서 Whisper를 실행합니다. NVIDIA·AMD·Intel GPU를 지원하고 PC 메모리에 맞춰 Tiny부터 Large-v3-turbo Q5 중 자동 선택하며, 실패해도 CPU나 클라우드 STT로 자동 전환하지 않습니다.")}</span>
                      </span>
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={lmsForm.detailMode === "detailed"}
                      onChange={() => setLmsForm({ ...lmsForm, detailMode: "detailed" })}
                    />
                    {t("상세 정리")}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={lmsForm.detailMode === "summary"}
                      onChange={() => setLmsForm({ ...lmsForm, detailMode: "summary" })}
                    />
                    {t("요약 정리")}
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] cursor-pointer">
                    <input
                      checked={lmsForm.skipVods}
                      onChange={(event) => {
                        setLmsForm({ ...lmsForm, skipVods: event.target.checked })
                        setNotice(event.target.checked ? t("강의 제외 옵션을 켰습니다.") : t("강의 제외 옵션을 껐습니다."))
                      }}
                      type="checkbox"
                    />
                    {t("강의 제외")}</label>
                  <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] cursor-pointer">
                    <input
                      checked={lmsForm.skipFiles}
                      onChange={(event) => {
                        setLmsForm({ ...lmsForm, skipFiles: event.target.checked })
                        setNotice(event.target.checked ? t("파일 제외 옵션을 켰습니다.") : t("파일 제외 옵션을 껐습니다."))
                      }}
                      type="checkbox"
                    />
                    {t("파일 제외")}</label>
                  <Button
                    disabled={lmsSubmitPending || isBusy("lms-scan-submit")}
                    onClick={() => void handleLmsScanSubmit()}
                    type="button"
                  >
                    {isBusy("lms-scan-submit") ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                    {t("스마트 일괄 분석 시작")}</Button>
                </div>
              </div>
            </div>
          )}
          {/* @ails-feature:summary.web_inputs:end */}

          {activeTab === "media" && (
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
              {/* @ails-feature:summary.media_files:start */}
              <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)]/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{t("로컬 영상 파일")}</h3>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      {t("MP4, MOV, MKV, WebM · 영상 분석은 PDF OCR과 별도로 처리됩니다.")}</p>
                  </div>
                  <Button
                    disabled={isBusy("pick-video")}
                    onClick={() => void handlePickVideoFile()}
                    size="sm"
                    variant="outline"
                  >
                    {isBusy("pick-video") ? <Loader2 className="animate-spin" size={15} /> : <FileVideo2 size={15} />}
                    {t("영상 선택")}</Button>
                </div>
                <Input
                  aria-label={t("선택한 영상 파일")}
                  placeholder={t("MP4, MOV, MKV 또는 WebM 영상을 선택하세요")}
                  readOnly
                  value={videoForm.videoPath}
                />
                <Input
                  aria-label={t("영상 학습 자료 제목")}
                  onChange={(event) => setVideoForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder={t("영상 학습 자료 제목")}
                  value={videoForm.title}
                />
                {SUMMARY_LOCAL_STT_ENABLED && (
                  <label className="flex items-start gap-2 rounded-lg border border-[var(--border)] p-3 text-sm">
                    <input
                      aria-label={t("로컬 STT 사용")}
                      checked={videoForm.localStt}
                      className="mt-0.5"
                      onChange={(event) => setVideoForm((current) => ({
                        ...current,
                        localStt: event.target.checked,
                      }))}
                      type="checkbox"
                    />
                    <span>
                      <span className="block font-medium">{t("로컬 STT 사용")}</span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
                        {t("Vulkan GPU에서 Whisper를 실행합니다. NVIDIA·AMD·Intel GPU를 지원하고 PC 메모리에 맞춰 Tiny부터 Large-v3-turbo Q5 중 자동 선택하며, 실패해도 CPU나 클라우드 STT로 자동 전환하지 않습니다.")}</span>
                    </span>
                  </label>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3">
                    <div>
                      <h4 className="text-sm font-semibold">{t("상세 정리")}</h4>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                        {t("시간 순서와 설명·예시·단계를 최대한 보존한 구조화된 강의 노트를 만듭니다.")}</p>
                    </div>
                    <Button
                      className="mt-auto"
                      disabled={
                        !videoForm.videoPath.trim()
                        || !videoForm.title.trim()
                        || isBusy("video-detailed-submit")
                        || isBusy("video-summary-submit")
                      }
                      onClick={() => void handleVideoSubmit("detailed")}
                    >
                      {isBusy("video-detailed-submit") ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                      {t("상세 정리")}</Button>
                  </div>
                  <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3">
                    <div>
                      <h4 className="text-sm font-semibold">{t("요약 정리")}</h4>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
                        {t("핵심 개념·결론·대표 장면 중심으로 재구성한 압축 학습 자료를 만듭니다.")}</p>
                    </div>
                    <Button
                      className="mt-auto"
                      disabled={
                        !videoForm.videoPath.trim()
                        || !videoForm.title.trim()
                        || isBusy("video-detailed-submit")
                        || isBusy("video-summary-submit")
                      }
                      onClick={() => void handleVideoSubmit("summary")}
                      variant="outline"
                    >
                      {isBusy("video-summary-submit") ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                      {t("요약 정리")}</Button>
                  </div>
                </div>
              </div>
              {/* @ails-feature:summary.media_files:end */}

              {/* @ails-feature:summary.audio_pdf:start */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="text-sm font-medium" htmlFor="audio-paths">
                    {t("오디오 파일 경로")}</label>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isBusy("pick-audio")}
                    onClick={() => void handlePickAudioFiles()}
                  >
                    {isBusy("pick-audio") ? (
                      <Loader2 className="animate-spin" size={15} />
                    ) : (
                      <FileAudio2 size={15} />
                    )}
                    {t("오디오 선택")}</Button>
                </div>
                <Textarea
                  className="min-h-16"
                  id="audio-paths"
                  onChange={(event) => {
                    const nextPath = event.target.value
                    const paths = nextPath
                      .split(/\r?\n/)
                      .map((item) => item.trim())
                      .filter(Boolean)
                    setAudioForm({
                      ...audioForm,
                      audioPath: nextPath,
                      title: paths.length === 1 ? titleFromPath(paths[0]) : audioForm.title,
                    })
                  }}
                  placeholder={t("여러 파일은 줄바꿈으로 입력")}
                  value={audioForm.audioPath}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <label className="text-sm font-medium">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    {t("PDF 경로")}<Button
                      variant="outline"
                      size="sm"
                      disabled={isBusy("pick-pdf")}
                      onClick={() => void handlePickPdfFile()}
                    >
                      {isBusy("pick-pdf") ? (
                        <Loader2 className="animate-spin" size={15} />
                      ) : (
                        <FileText size={15} />
                      )}
                      {t("PDF 선택")}</Button>
                  </div>
                  <Input
                    onChange={(event) => setAudioForm({ ...audioForm, pdfPath: event.target.value })}
                    value={audioForm.pdfPath}
                  />
                </label>
                <label className="text-sm font-medium">
                  {t("PDF 비밀번호")}<Input
                    className="mt-2"
                    onChange={(event) => setAudioForm({ ...audioForm, pdfPassword: event.target.value })}
                    type="password"
                    value={audioForm.pdfPassword}
                  />
                </label>
              </div>
              <Input
                onChange={(event) => setAudioForm({ ...audioForm, title: event.target.value })}
                placeholder={t("오디오 작업 제목")}
                value={audioForm.title}
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-sm text-[var(--muted-foreground)]">
                  <label className="flex items-center gap-2">
                    <input
                      checked={audioForm.sttOnly}
                      onChange={(event) => {
                        setAudioForm({ ...audioForm, sttOnly: event.target.checked })
                        setNotice(event.target.checked ? t("오디오 요약 생략 옵션을 켰습니다.") : t("오디오 요약 생략 옵션을 껐습니다."))
                      }}
                      type="checkbox"
                    />
                    {t("요약 생략(STT만)")}</label>
                  <label className="flex items-center gap-2">
                    <input
                      checked={audioForm.mp3Only}
                      onChange={(event) => {
                        setAudioForm({ ...audioForm, mp3Only: event.target.checked })
                        setNotice(event.target.checked ? t("오디오 STT 생략 옵션을 켰습니다.") : t("오디오 STT 생략 옵션을 껐습니다."))
                      }}
                      type="checkbox"
                    />
                    {t("STT 생략(MP3만)")}</label>
                </div>
                <Button disabled={isBusy("audio-submit")} onClick={() => {
                  void handleAudioSubmit()
                  setLectureAddExpanded(false)
                }}>
                  {isBusy("audio-submit") ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  {t("오디오 작업 추가")}</Button>
              </div>
              {/* @ails-feature:summary.audio_pdf:end */}
            </div>
          )}
          {/* @ails-summary-generation:end */}

          {activeTab === "markdown" && (
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-[240px] flex-1"
                  onChange={(event) => setMdForm({ ...mdForm, path: event.target.value })}
                  placeholder={t("MD 파일 경로 또는 아래에 본문 붙여넣기")}
                  value={mdForm.path}
                />
                <Button
                  variant="outline"
                  disabled={isBusy("pick-markdown")}
                  onClick={() => void handlePickMarkdownFile()}
                >
                  {isBusy("pick-markdown") ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                  {t("선택")}</Button>
              </div>
              <Textarea
                onChange={(event) => setMdForm({ ...mdForm, content: event.target.value })}
                placeholder={t("마크다운 본문")}
                value={mdForm.content}
              />
              <Button
                className="w-fit"
                disabled={isBusy("markdown-import")}
                onClick={() => {
                  void handleMarkdownImport()
                  setLectureAddExpanded(false)
                }}
              >
                {isBusy("markdown-import") ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
                {t("리포트 등록")}</Button>
            </div>
          )}
        </div>
      </div>

      <footer className="flex justify-end gap-2 border-t border-[var(--border)] p-4 shrink-0 bg-[var(--sidebar)]/40">
        <Button variant="outline" onClick={() => setLectureAddExpanded(false)}>
          {t("닫기")}</Button>
      </footer>
    </div>
  </div>
)}
    </>
  )
}
