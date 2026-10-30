import { t } from "../../../lib/i18n.ts"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, Wrench } from "lucide-react"

import {
  getDeveloperTools,
  getDeveloperToolInstallStatus,
  installDeveloperTool,
  type DeveloperToolInstallJob,
  type DeveloperToolStatus,
  type DeveloperToolsPayload,
} from "../../../lib/api"

const ONBOARDING_KEY = "ails_developer_tools_onboarding_v1"
const INSTALL_POLL_INTERVAL_MS = 700

function installPhaseLabel(job: DeveloperToolInstallJob) {
  switch (job.phase) {
    case "preparing": return t("패키지 정보 확인 중")
    case "downloading": return t("설치 파일 다운로드 중")
    case "verifying": return t("설치 파일 검증 중")
    case "installing": return t("컴파일러 설치 중")
    case "completed": return job.restart_recommended ? t("설치 완료 · AILS 재시작 권장") : t("설치 완료")
    case "failed": return t("설치 실패")
    default: return t("설치 준비 중")
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

interface DeveloperToolsPanelProps {
  mode?: "settings" | "onboarding"
  dark?: boolean
  initialPayload?: DeveloperToolsPayload | null
  onFinish?: () => void
}

export function DeveloperToolsPanel({
  mode = "settings",
  dark = false,
  initialPayload = null,
  onFinish,
}: DeveloperToolsPanelProps) {
  const [payload, setPayload] = useState<DeveloperToolsPayload | null>(initialPayload)
  const [loading, setLoading] = useState(!initialPayload)
  const [installingId, setInstallingId] = useState("")
  const [installJob, setInstallJob] = useState<DeveloperToolInstallJob | null>(null)
  const [installProgress, setInstallProgress] = useState("")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  const load = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const result = await getDeveloperTools(refresh)
      setPayload(result)
      if (mode === "onboarding") {
        setSelected((current) => {
          if (current.size > 0) return current
          return new Set(result.tools.filter((tool) => tool.recommended && !tool.installed).map((tool) => tool.id))
        })
      }
    } catch (error) {
      setErrors({ load: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => {
    if (!initialPayload) void load(false)
  }, [initialPayload, load])

  const missingTools = useMemo(
    () => payload?.tools.filter((tool) => !tool.installed) ?? [],
    [payload],
  )

  async function installOne(tool: DeveloperToolStatus) {
    setInstallingId(tool.id)
    setInstallJob(null)
    setErrors((current) => ({ ...current, [tool.id]: "" }))
    try {
      let job = await installDeveloperTool(tool.id)
      setInstallJob(job)
      let consecutivePollErrors = 0
      while (job.status === "queued" || job.status === "running") {
        await wait(INSTALL_POLL_INTERVAL_MS)
        try {
          job = await getDeveloperToolInstallStatus(job.job_id)
          consecutivePollErrors = 0
          setInstallJob(job)
        } catch (pollError) {
          consecutivePollErrors += 1
          if (consecutivePollErrors >= 4) throw pollError
        }
      }
      if (job.status === "failed") throw new Error(job.error || t("{p0} 설치에 실패했습니다.", { p0: tool.label }))
      await load(true)
      return true
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [tool.id]: error instanceof Error ? error.message : String(error),
      }))
      return false
    } finally {
      setInstallingId("")
    }
  }

  async function installSelected() {
    const queue = missingTools.filter((tool) => selected.has(tool.id))
    if (queue.length === 0) {
      localStorage.setItem(ONBOARDING_KEY, "done")
      onFinish?.()
      return
    }
    let allSucceeded = true
    for (let index = 0; index < queue.length; index += 1) {
      setInstallProgress(`${index + 1} / ${queue.length}`)
      if (!(await installOne(queue[index]))) allSucceeded = false
    }
    setInstallProgress("")
    if (allSucceeded) {
      localStorage.setItem(ONBOARDING_KEY, "done")
      onFinish?.()
    }
  }

  const panelClass = dark
    ? "border-white/10 bg-white/[0.025] text-white"
    : "border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]"
  const mutedClass = dark ? "text-white/45" : "text-[var(--muted-foreground)]"
  const rowClass = dark
    ? "border-white/10 bg-black/20"
    : "border-[var(--border)] bg-[var(--panel)]"

  if (loading && !payload) {
    return (
      <div className={`flex min-h-40 items-center justify-center gap-2 rounded-lg border text-sm ${panelClass}`}>
        <Loader2 className="animate-spin" size={16} /> {t("개발 도구를 확인하는 중...")}</div>
    )
  }

  return (
    <div className={`rounded-lg border ${panelClass}`}>
      <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${dark ? "border-white/10" : "border-[var(--border)]"}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Wrench size={15} className="text-[var(--brand)]" /> {t("언어 및 도구 체인")}</div>
          <p className={`mt-1 text-xs ${mutedClass}`}>{t("필요한 언어만 선택해 설치합니다. 설치 파일은 WinGet에서 직접 내려받습니다.")}</p>
        </div>
        <button
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${rowClass} disabled:opacity-50`}
          disabled={loading || Boolean(installingId)}
          onClick={() => void load(true)}
          title={t("설치 상태 새로 고침")}
          type="button"
        >
          <RefreshCw className={loading ? "animate-spin" : ""} size={14} />
        </button>
      </div>

      {!payload?.winget_available && (
        <div className="m-3 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          <AlertCircle className="shrink-0" size={15} /> {t("WinGet을 찾지 못했습니다. Microsoft App Installer를 먼저 설치하거나 업데이트해야 합니다.")}</div>
      )}

      {errors.load && (
        <div className="m-3 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{errors.load}</div>
      )}

      <div className="grid gap-2 p-3 md:grid-cols-2">
        {payload?.tools.map((tool) => {
          const installing = installingId === tool.id
          const visibleJob = installJob?.tool_id === tool.id ? installJob : null
          const selectable = mode === "onboarding" && !tool.installed
          return (
            <div className={`min-w-0 rounded-md border p-3 ${rowClass}`} key={tool.id}>
              <div className="flex items-start gap-3">
                {selectable ? (
                  <input
                    aria-label={t("{p0} 설치 선택", { p0: tool.label })}
                    checked={selected.has(tool.id)}
                    className="mt-1 h-4 w-4 accent-[var(--brand)]"
                    disabled={Boolean(installingId)}
                    onChange={(event) => {
                      setSelected((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(tool.id)
                        else next.delete(tool.id)
                        return next
                      })
                    }}
                    type="checkbox"
                  />
                ) : tool.installed ? (
                  <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-400" size={17} />
                ) : (
                  <AlertCircle className={`mt-0.5 shrink-0 ${mutedClass}`} size={17} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">{tool.label}</span>
                    {tool.recommended && (
                      <span className="rounded bg-[var(--brand)]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--brand)]">{t("권장")}</span>
                    )}
                    <span className={`text-[10px] ${tool.installed ? "text-emerald-400" : mutedClass}`}>
                      {tool.installed ? t("설치됨") : t("미설치")}
                    </span>
                  </div>
                  <p className={`mt-1 text-[10px] leading-4 ${mutedClass}`}>{tool.description}</p>
                  <div className={`mt-2 truncate font-mono text-[9px] ${mutedClass}`} title={tool.executable_path || tool.package_id}>
                    {tool.version || tool.executable_path || tool.package_id}
                  </div>
                </div>
                {mode === "settings" && !tool.installed && (
                  <button
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[var(--brand)] px-2.5 text-[10px] font-semibold text-white disabled:opacity-50"
                    disabled={!tool.install_supported || Boolean(installingId)}
                    onClick={() => void installOne(tool)}
                    type="button"
                  >
                    {installing ? <Loader2 className="animate-spin" size={13} /> : <Download size={13} />}
                    {t("설치")}</button>
                )}
              </div>
              {visibleJob && (
                <div className={`mt-3 rounded-md border p-2.5 ${dark ? "border-white/10 bg-black/25" : "border-[var(--border)] bg-[var(--muted)]/50"}`}>
                  <div className="flex items-center justify-between gap-3 text-[10px]">
                    <span className={visibleJob.status === "failed" ? "font-semibold text-red-300" : "font-semibold text-[var(--brand)]"}>
                      {installPhaseLabel(visibleJob)}
                    </span>
                    <span className={mutedClass}>
                      {Math.round(visibleJob.progress_percent)}% · {Math.round(visibleJob.elapsed_seconds)}{t("초")}</span>
                  </div>
                  <div className={`mt-2 h-1.5 overflow-hidden rounded-full ${dark ? "bg-white/10" : "bg-[var(--muted)]"}`}>
                    <div
                      className={`h-full transition-[width] duration-300 ${visibleJob.status === "failed" ? "bg-red-400" : visibleJob.status === "completed" ? "bg-emerald-400" : "bg-[var(--brand)]"}`}
                      style={{ width: `${Math.max(2, Math.min(100, visibleJob.progress_percent))}%` }}
                    />
                  </div>
                  {visibleJob.output && (
                    <pre className={`mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded p-2 font-mono text-[9px] leading-4 ${dark ? "bg-black/35 text-white/40" : "bg-[var(--background)] text-[var(--muted-foreground)]"}`}>
                      {visibleJob.output.split(/\r?\n/).slice(-8).join("\n")}
                    </pre>
                  )}
                </div>
              )}
              {errors[tool.id] && (
                <div className="mt-2 whitespace-pre-wrap break-words rounded bg-red-500/10 p-2 text-[10px] leading-4 text-red-300">
                  {errors[tool.id]}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {mode === "onboarding" && (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 ${dark ? "border-white/10" : "border-[var(--border)]"}`}>
          <span className={`text-xs ${mutedClass}`}>
            {installProgress ? t("설치 진행 {p0}", { p0: installProgress }) : t("{p0}개 선택됨", { p0: selected.size })}
          </span>
          <div className="flex items-center gap-2">
            <button
              className={`rounded-md border px-3 py-2 text-xs font-semibold ${rowClass}`}
              disabled={Boolean(installingId)}
              onClick={() => {
                localStorage.setItem(ONBOARDING_KEY, "done")
                onFinish?.()
              }}
              type="button"
            >
              {t("나중에")}</button>
            <button
              className="flex items-center gap-2 rounded-md bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              disabled={Boolean(installingId)}
              onClick={() => void installSelected()}
              type="button"
            >
              {installingId ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
              {t("선택 항목 설치")}</button>
          </div>
        </div>
      )}
    </div>
  )
}
export function DeveloperToolsOnboarding() {
  const [payload, setPayload] = useState<DeveloperToolsPayload | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_KEY) === "done") return
    let cancelled = false
    // Compiler discovery can spawn several processes; let the document's
    // initial render finish before starting this first-run-only inspection.
    const timer = window.setTimeout(() => {
      void getDeveloperTools(false).then((result) => {
        if (cancelled) return
        const hasMissingRecommended = result.tools.some((tool) => tool.recommended && !tool.installed)
        if (hasMissingRecommended) {
          setPayload(result)
          setOpen(true)
        } else {
          localStorage.setItem(ONBOARDING_KEY, "done")
        }
      }).catch(() => {
        // The code settings screen remains available if first-run detection fails.
      })
    }, 1500)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [])

  if (!open || !payload) return null
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4" data-ails-window="true">
      <section className="flex max-h-[calc(100vh-32px)] w-[min(920px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-2xl">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-base font-semibold">{t("개발 환경 선택")}</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {t("AILS 코드 실행에 필요한 도구가 없습니다. 지금 필요한 항목만 설치하거나 코드 설정에서 나중에 설치할 수 있습니다.")}</p>
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          <DeveloperToolsPanel initialPayload={payload} mode="onboarding" onFinish={() => setOpen(false)} />
        </div>
      </section>
    </div>
  )
}
