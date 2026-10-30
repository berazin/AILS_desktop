import type { ReactNode } from "react"
import type { AILSConfig, ModelSettings, ModelSelectionPreviewResponse } from "../../../lib/api"
import { MODEL_PIPELINES, MODEL_PIPELINE_STAGES, MODEL_WORKFLOW_LABELS, type ModelPipelineId, type ModelPipelineStageId } from "../lib/ai-model-pipelines.ts"
import { SettingsCard, SettingsRow, SETTINGS_SELECT_CLASS } from "./settings-layout.tsx"

export function PersonalModelSettings({ config, preview, onChange, pipeline, stageSettings }: {
  config: AILSConfig; preview: ModelSelectionPreviewResponse | null; onChange: (settings: ModelSettings) => void
  pipeline: ModelPipelineId | "common"; stageSettings?: Partial<Record<ModelPipelineStageId, ReactNode>>
}) {
  const current = config.ai_model_selection ?? { default: { mode: "managed_default" as const }, features: {} }
  const workflows = pipeline === "common" ? [null] : MODEL_PIPELINES[pipeline].workflows
  const models = preview?.chatgpt_models ?? []
  const localModel = config.local_voice_agent_model && config.local_voice_agent_model !== "auto" ? config.local_voice_agent_model : "qwen3-4b-instruct-2507-q4-k-m"
  const stages: readonly string[] = pipeline === "common" ? [] : pipeline === "summary" ? [...MODEL_PIPELINE_STAGES.summary.inputs, ...MODEL_PIPELINE_STAGES.summary.outputs] : MODEL_PIPELINE_STAGES[pipeline]
  return <SettingsCard title={pipeline === "common" ? "기본 AI · ChatGPT" : MODEL_PIPELINES[pipeline].title} description="ChatGPT 연결의 구독 사용량을 사용합니다. 로컬 기능은 이 PC에서 실행됩니다.">
    {preview?.chatgpt_error && <p role="alert" className="p-4 text-sm">{preview.chatgpt_error}</p>}
    {workflows.filter(workflow => workflow !== "insight_book").map(workflow => {
      if (workflow === "problem_review") return <p key={workflow} role="status" className="p-4 text-sm">PDF 자동 다중 모델 검수는 지원하지 않습니다. 로컬 OCR·문제 감지와 ChatGPT 문제 풀이를 사용할 수 있습니다.</p>
      const selected = workflow ? current.features[workflow] : current.default
      const model = selected?.mode === "managed" && selected.modelId.startsWith("openai/") ? selected.modelId.slice(7) : ""
      const value = selected?.mode === "local" ? `local:${selected.provider}` : model
      return <SettingsRow key={workflow ?? "default"} label={workflow ? MODEL_WORKFLOW_LABELS[workflow] : "기본 모델"} control={<select className={SETTINGS_SELECT_CLASS} aria-label={workflow ?? "기본 모델"} value={value} onChange={event => {
        const id = event.target.value
        const selection = id.startsWith("local:") ? { mode: "local" as const, provider: id.slice(6), modelId: selected?.mode === "local" && selected.provider === id.slice(6) ? selected.modelId : String((id === "local:LM Studio" ? config.lmstudio_summary_model_name || "local-model" : localModel)) } : id ? { mode: "managed" as const, modelId: `openai/${id}` } : { mode: "managed_default" as const }
        onChange(workflow ? { ...current, features: { ...current.features, [workflow]: selection } } : { ...current, default: selection })
      }}>
        <option value="">ChatGPT 연결 설정의 모델</option>
        {model && !models.some(item => item.id === model) && <option value={model}>{model} · 계정 확인 필요</option>}
        {models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {(workflow === "chatbot" || workflow === null) && <option value="local:llama.cpp">llama.cpp · 로컬</option>}
        {(workflow === "chatbot" || workflow === null) && <option value="local:LM Studio">LM Studio · 로컬</option>}
      </select>} />
    })}
    {Object.entries(stageSettings ?? {}).filter(([stage]) => stages.includes(stage)).map(([stage, content]) => <div key={stage}>{content}</div>)}
  </SettingsCard>
}

