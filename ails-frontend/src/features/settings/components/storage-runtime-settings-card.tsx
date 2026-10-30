import type { ReactNode } from "react"
import { Code2, FolderOpen, Loader2, Minus, Plus, RefreshCw } from "lucide-react"

import type { SettingsController } from "../hooks/use-settings-controller.ts"
import type { AILSConfig } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { SETTINGS_SELECT_CLASS, SettingsCard, SettingsRow } from "./settings-layout.tsx"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"

function clampParallelJobs(value: number) {
  return Math.min(4, Math.max(1, value))
}

export function StorageRuntimeSettingsCard({
  config,
  developerSettings,
  isBusy,
  onConfigValueChange,
  onPickPythonExecutable,
  onPickSaveDirectory,
  onRefreshPythonRuntime,
  runtime,
}: {
  config: AILSConfig
  developerSettings?: ReactNode
  isBusy: (key: string) => boolean
  onConfigValueChange: (key: string, value: string | number) => void
  onPickPythonExecutable: () => void
  onPickSaveDirectory: () => void
  onRefreshPythonRuntime: () => void
  runtime: SettingsController["runtime"]
}) {
  const { pythonExecutableValidation, pythonRuntime } = runtime

  return (
    <SettingsCard
      description={t("정리본 저장 위치와 문서 작업에 사용하는 실행 환경을 관리합니다.")}
      title={t("저장 및 실행 환경")}
    >
      <SettingsRow
        control={(
          <div className="flex gap-2">
            <Input
              onChange={(event) => onConfigValueChange("md_save_path", event.target.value)}
              placeholder={t("정리본 저장 폴더")}
              value={String(config.md_save_path ?? "")}
            />
            <Button
              variant="outline"
              size="icon"
              disabled={isBusy("pick-save-dir")}
              onClick={onPickSaveDirectory}
            >
              {isBusy("pick-save-dir") ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <FolderOpen size={16} />
              )}
            </Button>
          </div>
        )}
        label={t("정리본 저장 폴더")}
        layout="stacked"
      />
      <div className="grid gap-3 border-t border-[var(--border)] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-[var(--foreground)]">{t("파이썬 실행 환경")}</div>
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy("refresh-python-runtime")}
            onClick={onRefreshPythonRuntime}
          >
            {isBusy("refresh-python-runtime") ? (
              <Loader2 className="animate-spin" size={13} />
            ) : (
              <RefreshCw size={13} />
            )}
            {t("다시 감지")}
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
          {t("외부 Python 선택은 노트북과 문제풀이 코드 실행에 사용됩니다. 노트북의 기본 학습 환경과 프로젝트별 패키지는 노트북 상단의 ‘Python 환경 · 패키지’에서 관리하며 사용자 데이터 폴더에 보관합니다.")}
        </p>
        <select
          className={SETTINGS_SELECT_CLASS}
          value={String(config.python_kernel_executable ?? "")}
          onChange={(event) => {
            onConfigValueChange("python_kernel_executable", event.target.value)
            runtime.setPythonExecutableValidation(null)
          }}
        >
          <option value="">{t("자동(기본값)")}</option>
          {(pythonRuntime?.installations ?? []).map((installation) => (
            <option key={installation.path} value={installation.path}>
              {installation.version ? `Python ${installation.version}` : "Python"}
              {" — "}
              {installation.path}
            </option>
          ))}
          {Boolean(String(config.python_kernel_executable ?? "").trim())
            && !(pythonRuntime?.installations ?? []).some(
              (installation) => installation.path === String(config.python_kernel_executable ?? "").trim(),
            ) && (
              <option value={String(config.python_kernel_executable)}>
                {String(config.python_kernel_executable)}
              </option>
            )}
        </select>
        {pythonRuntime && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4">
            <span
              className={
                pythonRuntime.resolution_error
                  ? "rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-400"
                  : "rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-500"
              }
            >
              {pythonRuntime.resolution_error
                ? t("확인 필요")
                : ({ auto: t("자동"), custom: t("지정됨"), dev: t("개발 내장"), bundled: t("번들") } as Record<string, string>)[
                  pythonRuntime.mode
                ] ?? pythonRuntime.mode}
            </span>
            {pythonRuntime.effective_path && (
              <span
                className="min-w-0 truncate text-[var(--muted-foreground)]"
                title={pythonRuntime.effective_path}
              >
                {pythonRuntime.effective_path}
                {pythonRuntime.version ? ` · Python ${pythonRuntime.version}` : ""}
              </span>
            )}
            {pythonRuntime.resolution_error && <span className="text-red-400">{pythonRuntime.resolution_error}</span>}
            {!pythonRuntime.notebook_available && (
              <span className="text-amber-500">{t("이 빌드에는 노트북 커널이 포함되지 않았습니다.")}</span>
            )}
          </div>
        )}
        <details className="rounded-lg border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-[var(--muted-foreground)]">
            {t("고급: 직접 경로 지정")}
          </summary>
          <div className="mt-2 flex gap-2">
            <Input
              onChange={(event) => {
                onConfigValueChange("python_kernel_executable", event.target.value)
                runtime.queuePythonExecutableValidation(event.target.value)
              }}
              placeholder={t("예: C:\\Python312\\python.exe")}
              value={String(config.python_kernel_executable ?? "")}
            />
            <Button
              variant="outline"
              size="icon"
              disabled={isBusy("pick-python")}
              onClick={onPickPythonExecutable}
              title={t("파이썬 실행 파일 찾아보기")}
            >
              {isBusy("pick-python") ? <Loader2 className="animate-spin" size={16} /> : <Code2 size={16} />}
            </Button>
          </div>
          {pythonExecutableValidation && (
            <div
              className={`mt-2 text-[11px] leading-4 ${
                pythonExecutableValidation.ok ? "text-emerald-500" : "text-red-400"
              }`}
            >
              {pythonExecutableValidation.ok
                ? t("실행 확인 완료 · Python {p0}", { p0: pythonExecutableValidation.version })
                : pythonExecutableValidation.error}
            </div>
          )}
        </details>
      </div>
      {/* @ails-summary-generation:start */}
      <div className="flex items-center justify-between gap-6 border-t border-[var(--border)] px-5 py-4 first:border-t-0">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)]">{t("동시 강의 요약 작업 수")}</div>
          <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">{t("한 번에 진행하는 강의 요약 작업 수를 조절합니다.")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => onConfigValueChange("max_parallel_summary_jobs", clampParallelJobs(Number(config.max_parallel_summary_jobs ?? 2) - 1))}
            type="button"
          >
            <Minus size={14} />
          </Button>
          <div className="h-9 min-w-20 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-center text-sm font-medium tabular-nums">
            {clampParallelJobs(Number(config.max_parallel_summary_jobs ?? 2))}{t("개")}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onConfigValueChange("max_parallel_summary_jobs", clampParallelJobs(Number(config.max_parallel_summary_jobs ?? 2) + 1))}
            type="button"
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>
      {/* @ails-summary-generation:end */}
      {developerSettings}
    </SettingsCard>
  )
}
