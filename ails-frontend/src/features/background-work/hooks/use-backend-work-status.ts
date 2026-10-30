import { useEffect, useRef, type Dispatch, type SetStateAction } from "react"

import { t } from "../../../lib/i18n.ts"
import type { StatusPayload } from "../../../lib/api"

const EMPTY_ACTIVE_TASKS: NonNullable<StatusPayload["active_tasks"]> = []
const EMPTY_PENDING: NonNullable<StatusPayload["pending"]> = []
const EMPTY_RETRY_CANDIDATES: NonNullable<StatusPayload["retry_candidates"]> = []

type RefreshStatus = (options?: { scanDisk?: boolean; lite?: boolean }) => Promise<void>

type UseBackendWorkStatusOptions = {
  debugTraceOpen: boolean
  queueOpen?: boolean
  lmsScanBusy: boolean
  payload: StatusPayload | null
  refresh: RefreshStatus
  setGenerationNotices: Dispatch<SetStateAction<string[]>>
}

export function useBackendWorkStatus({
  debugTraceOpen,
  queueOpen = false,
  lmsScanBusy,
  payload,
  refresh,
  setGenerationNotices,
}: UseBackendWorkStatusOptions) {
  const knownRetryFailureTitlesRef = useRef<Set<string> | null>(null)
  const backendWorkWasActiveRef = useRef(false)
  const retryFailureTitlesAtWorkStartRef = useRef<Set<string>>(new Set())
  const refreshingRef = useRef(false)
  const activeTasks = payload?.active_tasks ?? EMPTY_ACTIVE_TASKS
  const retryCandidates = payload?.retry_candidates ?? EMPTY_RETRY_CANDIDATES
  const pending = payload?.pending ?? EMPTY_PENDING
  const currentStatus = payload?.status
  const currentProgress = Math.min(100, Math.max(0, Number(currentStatus?.progress_percent ?? 0)))
  const currentProgressLabel = currentStatus?.progress_label?.trim() || t("진행 중")
  const backendWorkActive = Boolean(currentStatus?.is_running || activeTasks.length > 0 || pending.length > 0)
  const shouldPoll = backendWorkActive || lmsScanBusy || debugTraceOpen || queueOpen

  useEffect(() => {
    const currentFailureTitles = retryCandidates.map((item) => item.title).filter(Boolean)
    const currentFailureTitleSet = new Set(currentFailureTitles)

    if (knownRetryFailureTitlesRef.current === null) {
      knownRetryFailureTitlesRef.current = currentFailureTitleSet
    } else {
      const known = knownRetryFailureTitlesRef.current
      const newFailures = retryCandidates.filter((item) => item.title && !known.has(item.title))
      if (newFailures.length > 0) {
        setGenerationNotices((previous) => [
          ...newFailures.map((item) => {
            const reason = item.last_error?.trim()
            if (item.status === "needs_review") {
              return reason
                ? t("확인 필요: {p0} ({p1})", { p0: item.title, p1: reason })
                : t("확인 필요: {p0} — 정리본이 저장됐으며 검토를 마쳐야 합니다.", { p0: item.title })
            }
            return reason
              ? t("작업 실패: {p0} ({p1})", { p0: item.title, p1: reason })
              : t("작업 실패: {p0}", { p0: item.title })
          }),
          ...previous,
        ].slice(0, 10))
      }
      knownRetryFailureTitlesRef.current = currentFailureTitleSet
    }

    if (backendWorkActive) {
      if (!backendWorkWasActiveRef.current) {
        retryFailureTitlesAtWorkStartRef.current = currentFailureTitleSet
      }
      backendWorkWasActiveRef.current = true
      return
    }

    if (backendWorkWasActiveRef.current) {
      backendWorkWasActiveRef.current = false
      const failuresAtStart = retryFailureTitlesAtWorkStartRef.current
      const failuresDuringRun = currentFailureTitles.filter((title) => !failuresAtStart.has(title))
      if (failuresDuringRun.length === 0) {
        setGenerationNotices((previous) => [t("모든 작업이 완료되었습니다."), ...previous].slice(0, 10))
      }
    }
  }, [backendWorkActive, retryCandidates, setGenerationNotices])

  useEffect(() => {
    const refreshStatus = () => {
      if (refreshingRef.current) return
      refreshingRef.current = true
      void refresh({ lite: true }).finally(() => { refreshingRef.current = false })
    }
    // Startup and local task actions already refresh once. While idle, another
    // client's work is discovered when this window regains focus.
    if (debugTraceOpen || queueOpen) refreshStatus()
    const statusTimer = shouldPoll ? window.setInterval(refreshStatus, 1500) : undefined
    window.addEventListener("focus", refreshStatus)
    return () => {
      window.clearInterval(statusTimer)
      window.removeEventListener("focus", refreshStatus)
    }
  }, [debugTraceOpen, queueOpen, refresh, shouldPoll])

  return {
    activeTasks,
    currentProgress,
    currentProgressLabel,
    currentStatus,
    pending,
    retryCandidates,
  }
}
