import { PERSONAL_MODE } from "../../../edition.ts"
import { PersonalModelSettings } from "./personal-model-settings.tsx"
import { useState, type ReactNode } from "react"

import type { AILSConfig, ManagedAiModelEntry, ManagedAiPolicyResponse, ModelSelection, ModelSelectionPreviewResponse, ModelSettings } from "../../../lib/api"
import { MODEL_PIPELINES, MODEL_PIPELINE_STAGE_LABELS, MODEL_PIPELINE_STAGES, MODEL_WORKFLOW_DESCRIPTIONS, MODEL_WORKFLOW_LABELS, type ModelPipelineId, type ModelPipelineStageId } from "../lib/ai-model-pipelines.ts"
import { t } from "../../../lib/i18n.ts"
import { SETTINGS_SELECT_CLASS, SettingsCard, SettingsRow } from "./settings-layout.tsx"
import { Input } from "../../../shared/ui/input.tsx"


function settings(config: AILSConfig): ModelSettings {
  const saved = config.ai_model_selection
  return {
    default: saved?.default ?? { mode: "managed_default" },
    features: saved?.features ?? {},
  }
}

function selectionValue(selection: ModelSelection | undefined, feature = false): string {
  if (!selection) return feature ? "inherit" : "managed_default"
  if (selection.mode === "managed") return `managed:${selection.modelId}`
  if (selection.mode === "local") return `local:${selection.provider}`
  return "managed_default"
}

function modelsForWorkflow(models: ManagedAiModelEntry[], policy: ManagedAiPolicyResponse | null, workflow: string): ManagedAiModelEntry[] {
  if (workflow === "problem_review") {
    return models.filter((model) => policy?.review_models?.includes(model.canonical_id ?? model.id) && model.capabilities?.includes("vision"))
  }
  if (workflow === "video_visual" || workflow === "image_analysis") {
    return models.filter((model) => model.capabilities?.includes("vision"))
  }
  if (workflow === "video_verification") {
    return models.filter((model) => model.capabilities?.includes("structured_output"))
  }
  return models
}

function stageTitle(stage: ModelPipelineStageId): string {
  return stage in MODEL_WORKFLOW_LABELS
    ? MODEL_WORKFLOW_LABELS[stage as keyof typeof MODEL_WORKFLOW_LABELS]
    : MODEL_PIPELINE_STAGE_LABELS[stage as "summary_stt" | "pdf_ocr"]
}

function stageDescription(stage: ModelPipelineStageId): string | undefined {
  return stage in MODEL_WORKFLOW_DESCRIPTIONS
    ? MODEL_WORKFLOW_DESCRIPTIONS[stage as keyof typeof MODEL_WORKFLOW_DESCRIPTIONS]
    : stage === "summary_stt"
      ? "정리본에 넣을 강의 음성 원문을 만듭니다."
      : stage === "pdf_ocr"
        ? "PDF 페이지에서 문자를 읽어 문제 검수와 번역에 전달합니다."
        : undefined
}

export function AiModelSettingsCard({ config, policy, policyError, preview, previewError, localEnabled, onChange, onConfigValueChange, pipeline, stageSettings, stageStatus, disabledModelWorkflows }: {
  config: AILSConfig
  policy: ManagedAiPolicyResponse | null
  policyError: boolean
  preview: ModelSelectionPreviewResponse | null
  previewError: boolean
  localEnabled: boolean
  onChange: (value: ModelSettings) => void
  onConfigValueChange: (key: string, value: string) => void
  pipeline: ModelPipelineId | "common"
  stageSettings?: Partial<Record<ModelPipelineStageId, ReactNode>>
  stageStatus?: Partial<Record<ModelPipelineStageId, string>>
  disabledModelWorkflows?: string[]
}) {
  const [expandedStage, setExpandedStage] = useState<ModelPipelineStageId | null>(null)
  if (PERSONAL_MODE) return <PersonalModelSettings config={config} preview={preview} onChange={onChange} pipeline={pipeline} stageSettings={stageSettings} />
  const current = settings(config)
  const accountModels = preview?.chatgpt_models ?? []
  const models = (policy?.provider_status === "on_hold" ? [] : policy?.models ?? []).map(model => ({ ...model }))
  for (const model of accountModels) {
    const id = `openai/${model.id}`
    const existing = models.find(entry => (entry.canonical_id ?? entry.id) === id)
    if (existing) existing.name = model.name
    else {
      models.push({ id, canonical_id: id, name: model.name, provider: "OpenAI", capabilities: ["text"] })
    }
  }

  function usesSubscription(modelId: string | undefined, workflow: string | null) {
    return workflow !== "problem_review" && Boolean(modelId?.startsWith("openai/") &&
      accountModels.some(model => `openai/${model.id}` === modelId))
  }

  function managedLabel(modelId: string | undefined) {
    const model = models.find((item) => item.canonical_id === modelId || item.id === modelId)
    return model?.name || accountModels.find(item => item.id === modelId)?.name || modelId || t("모델 목록을 불러오면 표시됩니다.")
  }

  function update(workflow: string | null, selection: ModelSelection | undefined) {
    if (!workflow) {
      onChange({ ...current, default: selection ?? { mode: "managed_default" } })
      return
    }
    const features = { ...current.features }
    if (selection) features[workflow] = selection
    else delete features[workflow]
    onChange({ ...current, features })
  }

  function onSelect(workflow: string | null, value: string) {
    if (value === "inherit") return update(workflow, undefined)
    if (value === "managed_default") return update(workflow, { mode: "managed_default" })
    if (value.startsWith("managed:")) return update(workflow, { mode: "managed", modelId: value.slice(8) })
    if (localEnabled && (value === "local:llama.cpp" || value === "local:LM Studio")) {
      const existing = workflow ? current.features[workflow] : current.default
      const provider = value.slice(6)
      const localModel = config.local_voice_agent_model && config.local_voice_agent_model !== "auto"
        ? config.local_voice_agent_model : "qwen3-4b-instruct-2507-q4-k-m"
      update(workflow, { mode: "local", provider, modelId: existing?.mode === "local" && existing.provider === provider ? existing.modelId : String(provider === "llama.cpp" ? localModel : config.lmstudio_summary_model_name ?? "local-model") })
    }
  }

  function row(workflow: keyof typeof MODEL_WORKFLOW_LABELS | null, label: string) {
    const selection = workflow ? current.features[workflow] : current.default
    const value = selectionValue(selection, Boolean(workflow))
    const choices = modelsForWorkflow(models, policy, workflow ?? "")
    const subscription = workflow ? preview?.workflows[workflow]?.mode === "chatgpt"
      : Object.values(preview?.workflows ?? {}).some(route => route.mode === "chatgpt" && route.source === "common")
    const currentSelectionMissing = selection?.mode === "managed" && !choices.some((model) => (model.canonical_id ?? model.id) === selection.modelId)
    const workflowDefault = workflow === "problem_review" ? policy?.review_models?.[0] : workflow ? policy?.workflow_defaults?.[workflow] : undefined
    const defaultLabel = workflow ? managedLabel(workflowDefault) : t("AILS가 각 단계의 기본 모델을 사용합니다.")
    return (
      <SettingsRow
        key={workflow ?? "default"}
        label={t(label)}
        description={workflow ? t(MODEL_WORKFLOW_DESCRIPTIONS[workflow]) : undefined}
        control={(
          <div className="space-y-2">
            <select className={SETTINGS_SELECT_CLASS} aria-label={t(label)} value={value} onChange={(event) => onSelect(workflow, event.target.value)}>
              {workflow && <option value="inherit">{t("공통 설정 따르기")}</option>}
              <option value="managed_default">{t(workflow ? "이 단계의 AILS 기본값" : "AILS 단계별 기본값")} · {defaultLabel}</option>
              {currentSelectionMissing && selection?.mode === "managed" && <option value={value}>{selection.modelId} · {t("현재 설정, 목록에 없음")}</option>}
              {selection?.mode === "local" && !localEnabled && <option value={value}>{selection.provider} · {t("이 에디션에서는 사용하지 않음")}</option>}
              {choices.map((model) => <option key={model.id} value={`managed:${model.canonical_id ?? model.id}`}>{model.name} [{usesSubscription(model.canonical_id ?? model.id, workflow) ? t("ChatGPT 구독") : "AILS"}]</option>)}
              {localEnabled && workflow === "chatbot" && <option value="local:llama.cpp">llama.cpp</option>}
              {localEnabled && workflow === "chatbot" && <option value="local:LM Studio">LM Studio (로컬)</option>}
            </select>
            {selection?.mode === "local" && selection.provider === "LM Studio" && <>
              <Input aria-label="LM Studio model" value={selection.modelId} onChange={event => update(workflow, { ...selection, modelId: event.target.value })} />
              <Input aria-label="LM Studio local endpoint" value={String(config.lmstudio_base_url ?? "http://127.0.0.1:1234/v1")} onChange={event => onConfigValueChange("lmstudio_base_url", event.target.value)} />
            </>}
            {selection?.mode === "local" && <p className="text-xs">{workflow && preview?.workflows[workflow]?.model_name}</p>}
            {subscription && <p role="status" className="text-xs text-[var(--muted-foreground)]">{t("연결 계정의 ChatGPT 구독 사용량을 사용합니다.")}</p>}
          </div>
        )}
      />
    )
  }

  if (pipeline === "common") {
    const inheritedCount = Object.values(MODEL_PIPELINES)
      .flatMap((entry) => entry.workflows)
      .filter((workflow) => !current.features[workflow]).length
    return (
      <SettingsCard
        title={t("공통 기본 모델")}
        description={t("단계별로 따로 선택하지 않은 클라우드 모델에 적용합니다. 현재 {p0}개 단계가 이 설정을 따릅니다.", { p0: inheritedCount })}
      >
        {!policy && !policyError && <p role="status" className="px-5 py-3 text-sm text-[var(--muted-foreground)]">{t("모델 목록을 불러오는 중입니다.")}</p>}
        {policyError && <p role="alert" className="px-5 py-3 text-sm text-[var(--destructive)]">{t("모델 목록을 불러오지 못했습니다. 설정을 다시 열어 주세요.")}</p>}
        {preview?.chatgpt_error && <p role="alert" className="px-5 py-3 text-sm text-[var(--destructive)]">{preview.chatgpt_error}</p>}
        {row(null, "공통 기본 모델")}
      </SettingsCard>
    )
  }

  const allStages: ModelPipelineStageId[] = pipeline === "summary"
    ? [...MODEL_PIPELINE_STAGES.summary.inputs, ...MODEL_PIPELINE_STAGES.summary.outputs]
    : [...MODEL_PIPELINE_STAGES[pipeline]]

  function routeSummary(stage: ModelPipelineStageId) {
    if (stageStatus?.[stage]) return stageStatus[stage]
    if (!(stage in MODEL_WORKFLOW_LABELS)) return null
    const workflow = stage as keyof typeof MODEL_WORKFLOW_LABELS
    const route = preview?.workflows[workflow]
    if (route?.mode === "error") return t("선택한 모델을 이 단계에서 사용할 수 없습니다.")
    if (!route) {
      const selection = current.features[workflow] ?? current.default
      return selection.mode === "managed" ? managedLabel(selection.modelId)
        : selection.mode === "local" ? `${selection.provider} · ${selection.provider === "llama.cpp" ? t("선택한 로컬 모델") : selection.modelId}`
          : managedLabel(policy?.workflow_defaults?.[workflow])
    }
    const modelName = route.mode === "local"
      ? `${route.provider} · ${route.model_name || (route.provider === "llama.cpp" ? t("선택한 로컬 모델") : route.model_id)}`
      : managedLabel(route.model_id)
    const source = route.source === "workflow" ? t("이 단계에서 직접 지정")
      : route.source === "common" ? current.default.mode === "managed_default"
        ? t("공통 설정 · AILS 단계별 기본값") : t("공통 설정")
        : t("이 단계의 AILS 기본값")
    return `${modelName} · ${source}${route.mode === "chatgpt" ? ` · ${t("ChatGPT 구독 사용량")}` : ""}`
  }

  function renderStage(stage: ModelPipelineStageId) {
    const isWorkflow = stage in MODEL_WORKFLOW_LABELS
    const workflow = isWorkflow ? stage as keyof typeof MODEL_WORKFLOW_LABELS : null
    const route = workflow ? preview?.workflows[workflow] : undefined
    const expanded = expandedStage === stage
    const localContent = stageSettings?.[stage]
    return (
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]" key={stage}>
        <button
          aria-expanded={expanded}
          className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-[var(--muted)]/40"
          onClick={() => setExpandedStage(expanded ? null : stage)}
          type="button"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[var(--foreground)]">{t(stageTitle(stage))}</span>
            {stageDescription(stage) && <span className="mt-0.5 block text-xs leading-5 text-[var(--muted-foreground)]">{t(stageDescription(stage)!)}</span>}
            <span className="mt-1 block truncate text-xs text-[var(--muted-foreground)]">{routeSummary(stage)}</span>
            {route?.fallback_reason && <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">{t(route.fallback_reason)}</span>}
            {route?.mode === "error" && <span className="mt-1 block text-xs text-[var(--destructive)]">{t(route.error || "모델 선택을 확인해 주세요.")}</span>}
          </span>
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--muted-foreground)]">{expanded ? "−" : "+"}</span>
        </button>
        {expanded && (
          <div className="border-t border-[var(--border)] bg-[var(--background)]/40">
            {localContent}
            {workflow && !disabledModelWorkflows?.includes(workflow) && row(workflow, MODEL_WORKFLOW_LABELS[workflow])}
          </div>
        )}
      </section>
    )
  }

  return (
    <SettingsCard title={t(MODEL_PIPELINES[pipeline].title)} description={t(MODEL_PIPELINES[pipeline].description)}>
      {policy?.provider_status === "on_hold" && <p role="status" className="px-5 py-3 text-sm text-amber-700 dark:text-amber-300">{t("Vercel은 현재 보류 중입니다. 이 개발 채널에서는 로컬 AI를 사용할 수 있습니다.")}</p>}
      {!policy && !policyError && <p role="status" className="border-b border-[var(--border)] px-5 py-3 text-sm text-[var(--muted-foreground)]">{t("모델 목록을 불러오는 중입니다.")}</p>}
      {policyError && <p role="alert" className="border-b border-[var(--border)] px-5 py-3 text-sm text-[var(--destructive)]">{t("적용 모델을 확인하지 못했습니다. 모델 목록을 다시 불러와 주세요.")}</p>}
      {previewError && <p role="alert" className="border-b border-[var(--border)] px-5 py-3 text-sm text-[var(--destructive)]">{t("적용 모델을 확인하지 못했습니다. 잠시 후 다시 설정을 열어 주세요.")}</p>}
      {pipeline === "summary" ? (
        <>
          <div className="space-y-2 border-b border-[var(--border)] px-4 pb-4 pt-3">
            <p className="px-1 text-xs font-semibold text-[var(--muted-foreground)]">{t("음성 원문 준비")}</p>
            {renderStage("summary_stt")}
            {renderStage("video_stt_cleanup")}
            <p className="px-1 pt-2 text-xs font-semibold text-[var(--muted-foreground)]">{t("입력 종류에 따라 분석")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="px-1 text-xs text-[var(--muted-foreground)]">{t("영상 정리")}</p>
                {renderStage("video_visual")}
              </div>
              <div className="space-y-1">
                <p className="px-1 text-xs text-[var(--muted-foreground)]">{t("오디오 + 첨부 PDF 정리")}</p>
                {renderStage("image_analysis")}
              </div>
            </div>
          </div>
          <div className="space-y-2 px-4 pb-4 pt-3">
            <p className="px-1 text-xs font-semibold text-[var(--muted-foreground)]">{t("정리본 작성과 검증")}</p>
            {MODEL_PIPELINE_STAGES.summary.outputs.map(renderStage)}
          </div>
        </>
      ) : (
        <div className="space-y-2 px-4 py-4">{allStages.map(renderStage)}</div>
      )}
    </SettingsCard>
  )
}
