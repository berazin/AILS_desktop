import {
  cancelAllTasks,
  cancelCurrentTask,
  cancelPendingTask,
  cancelTask,
  deleteRetryCandidate,
  openDistributionLicenses,
  pauseCurrentTask,
  pauseTask,
  resumeCurrentTask,
  resumeTask,
  retryAllFailedTasks,
  retryFailedTask,
  runLatexPostprocess,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import type { SettingsController } from "../../settings/hooks/use-settings-controller.ts"

type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
  onError?: (error: unknown) => void,
) => Promise<void>

type UseTaskOperationsOptions = {
  refreshMaterials: () => Promise<unknown>
  refreshStatus: () => Promise<unknown>
  runInteraction: RunInteraction
  runtime: SettingsController["runtime"]
}

export function useTaskOperations({
  refreshMaterials,
  refreshStatus,
  runInteraction,
  runtime,
}: UseTaskOperationsOptions) {
  async function handleOpenDistributionLicenses() {
    await runInteraction("open-licenses", t("오픈소스 라이선스 열기"), async () => {
      const result = await openDistributionLicenses()
      return t("라이선스 폴더를 열었습니다: {p0}", { p0: result.path })
    })
  }

  async function handleCancelCurrent() {
    await runInteraction("cancel-current", t("현재 작업 취소"), async () => {
      const result = await cancelCurrentTask()
      await refreshStatus()
      return result.cancelled ? t("현재 작업 취소를 요청했습니다.") : t("진행 중인 작업이 없습니다.")
    })
  }

  async function handlePauseCurrent() {
    await runInteraction("pause-current", t("현재 작업 일시정지"), async () => {
      const result = await pauseCurrentTask()
      await refreshStatus()
      return result.paused ? t("현재 작업을 일시정지했습니다.") : t("진행 중인 작업이 없습니다.")
    })
  }

  async function handleResumeCurrent() {
    await runInteraction("resume-current", t("현재 작업 재개"), async () => {
      const result = await resumeCurrentTask()
      await refreshStatus()
      return result.resumed ? t("현재 작업을 재개했습니다.") : t("일시정지된 작업이 없습니다.")
    })
  }

  async function handleCancelAllTasks() {
    await runInteraction("cancel-all", t("전체 작업 취소"), async () => {
      const result = await cancelAllTasks()
      await refreshStatus()
      return result.cancelled ? t("전체 작업 취소를 요청했습니다.") : t("취소할 작업이 없습니다.")
    })
  }

  async function handlePauseTask(taskId: number) {
    await runInteraction(`pause-task-${taskId}`, t("작업 일시정지"), async () => {
      const result = await pauseTask(taskId)
      await refreshStatus()
      return result.paused ? t("작업을 일시정지했습니다.") : t("일시정지할 작업이 없습니다.")
    })
  }

  async function handleResumeTask(taskId: number) {
    await runInteraction(`resume-task-${taskId}`, t("작업 재개"), async () => {
      const result = await resumeTask(taskId)
      await refreshStatus()
      return result.resumed ? t("작업을 재개했습니다.") : t("재개할 작업이 없습니다.")
    })
  }

  async function handleCancelTask(taskId: number) {
    await runInteraction(`cancel-task-${taskId}`, t("작업 취소"), async () => {
      const result = await cancelTask(taskId)
      await refreshStatus()
      return result.cancelled ? t("작업 취소를 요청했습니다.") : t("취소할 작업이 없습니다.")
    })
  }

  async function handleCancelPending(taskId: number) {
    await runInteraction(`cancel-pending-${taskId}`, t("대기열 작업 취소"), async () => {
      await cancelPendingTask(taskId)
      await refreshStatus()
      return t("대기열 작업을 취소했습니다.")
    })
  }

  async function handleLatexPostprocess() {
    await runInteraction("latex-postprocess", "LaTeX postprocess", async () => {
      const result = await runLatexPostprocess()
      await Promise.all([refreshStatus(), refreshMaterials()])
      return `LaTeX postprocess complete: updated ${result.updated}, unchanged ${result.unchanged}`
    })
  }

  async function handleRetryFailed(title: string) {
    await runInteraction(`retry-${title}`, "retry task", async () => {
      await retryFailedTask(title)
      await refreshStatus()
      return t("재시도 작업을 추가했습니다: {p0}", { p0: title })
    })
  }

  async function handleRetryAllFailed() {
    await runInteraction("retry-all", "retry all", async () => {
      const result = await retryAllFailedTasks()
      await refreshStatus()
      return `Retry queued: ${result.queued.length}, failed ${result.failed.length}`
    })
  }

  async function handleDeleteRetryCandidate(title: string) {
    await runInteraction(`retry-delete-${title}`, t("재시도 항목 삭제"), async () => {
      await deleteRetryCandidate(title)
      await refreshStatus()
      return t("재시도 목록에서 삭제했습니다: {p0}", { p0: title })
    })
  }

  async function handlePickSaveDirectory() {
    await runInteraction("pick-save-dir", t("정리본 저장 폴더 선택"), () => runtime.pickSaveDirectory())
  }

  async function handlePickPythonExecutable() {
    await runInteraction("pick-python", t("파이썬 실행 파일 선택"), () => runtime.pickPythonExecutable())
  }

  async function refreshPythonRuntime() {
    await runInteraction("refresh-python-runtime", t("파이썬 환경 재감지"), () => runtime.refreshPythonRuntime())
  }

  return {
    handleCancelAllTasks,
    handleCancelCurrent,
    handleCancelPending,
    handleCancelTask,
    handleDeleteRetryCandidate,
    handleLatexPostprocess,
    handleOpenDistributionLicenses,
    handlePauseCurrent,
    handlePauseTask,
    handlePickPythonExecutable,
    handlePickSaveDirectory,
    handleResumeCurrent,
    handleResumeTask,
    handleRetryAllFailed,
    handleRetryFailed,
    refreshPythonRuntime,
  }
}
