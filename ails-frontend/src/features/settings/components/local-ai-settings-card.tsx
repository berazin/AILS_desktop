import { useEffect, useRef, useState } from "react"
import { Download, Loader2, RefreshCw } from "lucide-react"
import { analyzeLocalAi, downloadLocalAi, getLocalAiStatus, selectLocalAi,
  type LocalAiPriority, type LocalAiProgress, type LocalAiReport, type LocalAiSelection, type LocalAiStatus, type LocalAiVerification } from "../../../lib/api/local-ai.ts"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { SettingsCard } from "./settings-layout.tsx"
import { isDefaultLocalAiRecommendation } from "../lib/local-ai-recommendation-filter.ts"

const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`
const priorities: Record<LocalAiPriority, string> = { balanced: "균형", quality: "품질 우선", speed: "속도 우선" }

export function LocalAiSettingsCard({ active, onSelect }: {
  active: boolean; onSelect: (selection: LocalAiSelection) => void
}) {
  const [status, setStatus] = useState<LocalAiStatus | null>(null)
  const [report, setReport] = useState<LocalAiReport | null>(null)
  const [priority, setPriority] = useState<LocalAiPriority>("balanced")
  const [showAllModels, setShowAllModels] = useState(false)
  const [busy, setBusy] = useState("")
  const [progress, setProgress] = useState<LocalAiProgress | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [verification, setVerification] = useState<LocalAiVerification>()
  const [cancellable, setCancellable] = useState(false)
  const download = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; download.current?.abort() } }, [])
  useEffect(() => {
    if (!active || download.current) return
    const controller = new AbortController()
    setBusy("분석 중")
    setError("")
    void getLocalAiStatus(controller.signal).then(async initial => {
      if (controller.signal.aborted) return
      setStatus(initial)
      if (initial.tool.ready) {
        const next = await analyzeLocalAi(false, controller.signal)
        if (!controller.signal.aborted) { setReport(next); setStatus({ ...next, installed: initial.installed, runtime: initial.runtime }) }
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(String(reason.message || reason)) })
      .finally(() => { if (!controller.signal.aborted) setBusy("") })
    return () => controller.abort()
  }, [active])

  async function analyze(refresh = true) {
    setBusy("분석 중"); setError(""); setReport(null)
    try {
      const next = await analyzeLocalAi(refresh)
      if (mounted.current) { setReport(next); setStatus(next) }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (mounted.current) setBusy("") }
  }

  async function install(action: "tool" | "pull", model?: string) {
    const controller = new AbortController()
    download.current = controller
    setCancellable(true); setVerification(undefined)
    setBusy(action === "tool" ? "분석 도구 준비" : "모델 설치 중"); setError(""); setNotice(""); setProgress(null)
    try {
      await downloadLocalAi(action, model, event => { if (mounted.current) setProgress(event) }, controller.signal)
      if (action === "pull") {
        const result = await downloadLocalAi("verify", model, event => { if (mounted.current) setProgress(event) }, controller.signal)
        if (mounted.current) setVerification(result)
      }
      if (!mounted.current) return
      setNotice(t(action === "tool" ? "분석 도구가 준비되었습니다." : "설치와 실행 테스트 완료. 챗봇 모델로 선택할 수 있습니다."))
      await analyze(true)
    } catch (reason) {
      if (mounted.current) setError(controller.signal.aborted ? t("다운로드 요청을 취소했습니다. 다시 분석하여 설치 상태를 확인해 주세요.") : reason instanceof Error ? reason.message : String(reason))
    } finally { download.current = null; if (mounted.current) { setBusy(""); setProgress(null); setCancellable(false) } }
  }

  async function choose(model: string) {
    const controller = new AbortController()
    download.current = controller
    setCancellable(true); setVerification(undefined)
    setBusy("실행 확인 중"); setError(""); setNotice("")
    try {
      const result = await downloadLocalAi("verify", model, event => { if (mounted.current) setProgress(event) }, controller.signal)
      if (mounted.current) setVerification(result)
      const selected = await selectLocalAi(model)
      if (!mounted.current) return
      onSelect(selected)
      setNotice(t("챗봇 모델을 선택했습니다. 자동 저장 후 일반 채팅과 PDF 질문·답변에 적용됩니다."))
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { download.current = null; if (mounted.current) { setBusy(""); setProgress(null); setCancellable(false) } }
  }

  const installed = status?.installed ?? []
  const installedNames = new Set(installed.map(model => model.id))
  const candidates = report?.models ?? []
  const recommendations = candidates.filter(model => showAllModels || isDefaultLocalAiRecommendation(model))
    .sort((a, b) => priority === "balanced" ? a.llmfit_rank - b.llmfit_rank : b.scores[priority] - a.scores[priority])
    .slice(0, showAllModels ? undefined : 6)
  const system = report?.system
  const percentage = progress?.total ? Math.min(100, Math.floor(Number(progress.completed || 0) / progress.total * 100)) : null

  return <SettingsCard title={t("내 PC에 맞는 로컬 AI")} description={t("하드웨어에 맞는 GGUF 모델을 추천하고 AILS의 llama.cpp로 실행합니다. 일반 채팅과 PDF 질문·답변에 사용할 수 있습니다.")}>
    <div className="space-y-4 px-5 pb-5 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-sm">{status?.runtime.ready ? t("AILS llama.cpp 준비됨") : t("로컬 실행 환경 확인 중")}</span>
        <Button variant="outline" disabled={Boolean(busy)} onClick={() => void analyze()}><RefreshCw size={14} className="mr-2" />{t("다시 분석")}</Button>
      </div>
      {status && !status.runtime.ready && <p role="alert" className="text-sm text-[var(--destructive)]">{status.runtime.error}</p>}
      {status && !status.tool.ready && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
        <p className="text-sm">{t("자동 추천에 사용할 llmfit 분석 도구")}: {bytes(status.tool.download_bytes)} · MIT</p>
        {status.tool.install_supported ? <Button disabled={Boolean(busy)} onClick={() => void install("tool")}>{t("분석 도구 준비")}</Button>
          : <a className="text-sm underline" href="https://github.com/AlexsJones/llmfit/releases" target="_blank" rel="noreferrer">{t("llmfit 설치 안내")}</a>}
      </div>}
      {system?.cpu_name && <div className="rounded-lg bg-[var(--muted)]/30 p-3 text-sm leading-6">
        <p>{system.cpu_name} · {system.cpu_cores} {t("코어")}</p>
        <p>RAM {system.total_ram_gb?.toFixed(1)} GB · {t("현재 사용 가능")} {system.available_ram_gb?.toFixed(1)} GB</p>
        <p>{system.gpu_name || t("GPU 감지 안 됨")} · {system.unified_memory || system.shared_memory_detected ? t("평가에 사용한 공유 메모리") : t("감지된 GPU 메모리")} {system.gpu_vram_gb ?? "—"} GB</p>
        <p className="text-xs text-[var(--muted-foreground)]">{system.os}</p>
      </div>}
      {report?.warnings.map(warning => <p className="text-xs leading-5 text-[var(--muted-foreground)]" key={warning}>{warning}</p>)}
      {busy && <div role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm">
        <div className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" />{progress?.status || t(busy)}
          {cancellable && <Button size="sm" variant="ghost" onClick={() => download.current?.abort()}>{t("취소")}</Button>}</div>
        {percentage !== null && <><progress aria-label={t("전체 다운로드 진행률")} className="mt-2 w-full" value={percentage} max={100} />
          <p className="text-xs">{t("전체 다운로드")} {percentage}% · {bytes(Number(progress?.completed || 0))} / {bytes(Number(progress?.total || 0))}</p></>}
      </div>}
      {error && <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p>}
      {notice && <p role="status" className="text-sm text-[var(--foreground)]">{notice}</p>}
      {verification && <p className="rounded-lg bg-[var(--muted)]/30 p-3 text-sm">{verification.source_model} · {verification.quantization} · {verification.runtime_context?.toLocaleString()} {t("토큰 문맥 확인")}
        <br />{t("짧은 실행 테스트")}: {verification.gpu_used === true ? t("GPU 사용 확인") : verification.gpu_used === false ? t("CPU 실행 확인") : t("가속 여부 미확인")} · {verification.measured_tps ?? "—"} tok/s ({t("실측")})</p>}
      {report && <>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={showAllModels} onChange={event => setShowAllModels(event.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
          {t("모든 모델 표시")}
        </label>
        <p className="text-xs text-[var(--muted-foreground)]">{t("기본 추천은 이름에 Distill, Uncensored, Base 등 제외 키워드가 있는 모델을 숨깁니다. 모든 모델 표시를 켜면 직접 설치하고 사용할 수 있습니다.")}</p>
        {recommendations.length === 0 && <p role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm">
          {t(candidates.length > 0 ? "기본 추천 조건에 맞는 모델이 없습니다. 모든 모델 표시를 켜서 후보를 확인해 주세요." : "추천 후보가 없습니다. 다시 분석하거나 이미 설치된 로컬 모델을 사용해 주세요.")}
        </p>}
      </>}
      {recommendations.length > 0 && <>
        <div role="group" aria-label={t("로컬 AI 추천 기준")} className="flex gap-2">{(Object.keys(priorities) as LocalAiPriority[]).map(key =>
          <Button key={key} size="sm" variant={key === priority ? "default" : "outline"} aria-pressed={key === priority} onClick={() => setPriority(key)}>{t(priorities[key])}</Button>)}</div>
        <p className="text-xs text-[var(--muted-foreground)]">{t("균형은 llmfit 추천 순위를 따릅니다. 품질·속도는 llmfit 값으로 정렬합니다. 추천 양자화와 실제 GGUF를 대조하고, AILS의 8,192 토큰 문맥으로 실행합니다.")}</p>
        <div className="grid gap-3 lg:grid-cols-2">{recommendations.map(model => <article key={model.id} className="space-y-2 rounded-xl border border-[var(--border)] p-4">
          <h4 className="font-medium">{model.name}</h4>
          <p className="break-all text-xs text-[var(--muted-foreground)]">{model.filename} · {model.quantization}</p>
          <p className="text-sm">{model.execution} {t("실행 예상")} · {t("예상 메모리")} {model.memory_gb} GB · {t("예상 속도")} {model.estimated_tps} tok/s</p>
          <p className="text-xs">{t("설치 크기")} {bytes(model.download_bytes)} · {t("llmfit 품질 점수")} {model.scores.quality.toFixed(0)}/100</p>
          <p className="text-xs">{t("평가 문맥")} {model.context.toLocaleString()} · {t("llmfit 카탈로그 최대 문맥")} {model.max_context?.toLocaleString() || "—"}</p>
          <p className="text-xs text-[var(--muted-foreground)]">{model.reasons.join(" · ")}</p>
          <div className="flex items-center justify-between gap-2 pt-1">
            <a className="text-xs underline" href={model.model_url} target="_blank" rel="noreferrer">{model.license || t("모델 라이선스 확인")}</a>
            {installedNames.has(model.id) ? <Button size="sm" disabled={Boolean(busy)} onClick={() => void choose(model.id)}>{t("챗봇 모델로 선택")}</Button>
              : <Button size="sm" disabled={Boolean(busy) || !status?.runtime.ready} onClick={() => void install("pull", model.id)}><Download size={14} className="mr-1" />{t("설치 및 실행 확인")}</Button>}
          </div>
          {installedNames.has(model.id) && <p className="text-xs text-[var(--muted-foreground)]">{t("이미 설치됨 · 다시 다운로드하지 않습니다.")}</p>}
        </article>)}</div>
      </>}
      {installed.length > 0 && <details className="rounded-lg border border-[var(--border)] p-3"><summary className="cursor-pointer text-sm">{t("이미 설치된 로컬 모델")} ({installed.length})</summary>
        <div className="mt-3 space-y-2">{installed.map(model => <div key={model.id} className="flex items-center justify-between gap-2 text-sm">
          <span>{model.name} · {bytes(model.size)}</span><Button size="sm" variant="outline" disabled={Boolean(busy) || !status?.runtime.ready} onClick={() => void choose(model.id)}>{t("실행 확인 후 선택")}</Button>
        </div>)}</div></details>}
    </div>
  </SettingsCard>
}
