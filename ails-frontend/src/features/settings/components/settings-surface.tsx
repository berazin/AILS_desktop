import { PERSONAL_MODE } from "../../../edition.ts"
import { OpenRouterSearchSettings } from "./openrouter-search-settings.tsx"
import { AiProviderSettingsPanel } from "./ai-provider-settings.tsx"
import { SubscriptionUnavailableNotice } from "./subscription-unavailable-notice.tsx"
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from "react"
import type { ChatGPTStatus } from "../../../lib/api/chatgpt.ts"

import { LOCAL_AI_SETTINGS_ENABLED } from "../../../edition.ts"
import { previewAiModelSelections, type ManagedAiPolicyResponse, type ModelSelectionPreviewResponse, type LocalModelsStatus, type AILSOptions, type PhoenixStatus, type ModelSettings } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { availableSttProviderOptions } from "../../../lib/stt-config.ts"
import type { AppearanceController } from "../hooks/use-appearance-controller.ts"
import type { DebugTraceWorkflow } from "../../desktop-shell/hooks/use-debug-trace-workflow.ts"
import type { InteractionRunner } from "../../code-sandbox/hooks/use-interaction-runner.ts"
import type { ManagedAccountController } from "../hooks/use-managed-account.ts"
import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import type { SettingsController } from "../hooks/use-settings-controller.ts"
import type { SettingsWorkflows } from "../hooks/use-settings-workflows.ts"
import { AccountSettingsSection } from "./account-settings-section.tsx"
import { AiModelSettingsCard } from "./ai-model-settings-card.tsx"
/* @ails-feature:insight_book:start */
import { InsightBookSettingsRow } from "./insight-book-settings-row.tsx"
/* @ails-feature:insight_book:end */
import { AppearanceSettingsSection } from "./appearance-settings-section.tsx"
import { BackgroundWorkSettingsCard } from "./background-work-settings-card.tsx"
import { ChatbotSettingsCard } from "./chatbot-settings-card.tsx"
import { DeveloperTraceSettingsRows } from "./developer-trace-settings-rows.tsx"
import { LocalModelsPrepareRow } from "./local-models-prepare-row.tsx"
import { LocalAiSettingsCard } from "./local-ai-settings-card.tsx"
import { applyLocalAiSelection } from "../lib/local-ai-selection.ts"
import { LocalProblemReviewModelRow, LocalVoiceModelRow } from "./local-ai-model-rows.tsx"
import { SETTINGS_SELECT_CLASS, SettingsCard, SettingsRow } from "./settings-layout.tsx"
import { PdfOcrSettingsSection } from "./pdf-ocr-settings-section.tsx"
import { SettingsSupportSections } from "./settings-support-sections.tsx"
import { SettingsWorkspace } from "./settings-workspace.tsx"
import { INSIGHT_BOOK_ENABLED } from "../../../edition.ts"
import { MODEL_PIPELINES, type ModelPipelineId, type ModelPipelineStageId } from "../lib/ai-model-pipelines.ts"
import { StorageRuntimeSettingsCard } from "./storage-runtime-settings-card.tsx"
import { SummaryVerificationSettingsRows } from "./summary-verification-settings-rows.tsx"
import { VoiceSettingsCard } from "./voice-settings-card.tsx"
import { Input } from "../../../shared/ui/input.tsx"

type PdfOcrSettingsProps = ComponentProps<typeof PdfOcrSettingsSection>
const DEFAULT_MODEL_SETTINGS: ModelSettings = { default: { mode: "managed_default" }, features: {} }

type SettingsSurfaceProps = {
  account: ManagedAccountController
  active: boolean
  appearance: AppearanceController
  debugTrace: DebugTraceWorkflow
  isBusy: InteractionRunner["isBusy"]
  metadata: {
    managedAiPolicy: ManagedAiPolicyResponse | null
    managedAiPolicyError: boolean
    phoenixStatus: PhoenixStatus | null
  }
  options: AILSOptions | null
  pdf: PdfController
  settings: SettingsController
  setNotice: (notice: string) => void
  workflows: SettingsWorkflows
  actions: {
    benchmarkPdfOcr: PdfOcrSettingsProps["onBenchmark"]
    copyDebugTrace: () => void
    navigatePdf: (page: number) => void
    normalizePdfOcrModelVariant: PdfOcrSettingsProps["normalizeModelVariant"]
    openBackgroundQueue: () => void
    openDistributionLicenses: () => void
    pickPythonExecutable: () => void
    pickSaveDirectory: () => void
    refreshPythonRuntime: () => void
    saveLmsCredentials: () => void
    searchPdf: (query?: string) => void
    togglePdfOutlineSection: (key: string) => void
  }
}

export function SettingsSurface({
  account,
  active,
  actions,
  appearance,
  debugTrace,
  isBusy,
  metadata,
  options,
  pdf,
  settings,
  setNotice,
  workflows,
}: SettingsSurfaceProps) {
  const [selectedModelPipeline, setSelectedModelPipeline] = useState<ModelPipelineId>("summary")
  const [modelSelectionPreview, setModelSelectionPreview] = useState<ModelSelectionPreviewResponse | null>(null)
  const [modelSelectionPreviewError, setModelSelectionPreviewError] = useState(false)
  const [localModelsStatus, setLocalModelsStatus] = useState<LocalModelsStatus | null>(null)
  const [chatgptConnection, setChatgptConnection] = useState("")
  const onChatGPTConnectionChange = useCallback((status: ChatGPTStatus) => {
    setChatgptConnection(`${status.available}:${status.connected}:${status.plan_enabled}:${status.email}`)
  }, [])
  const config = settings.config
  const modelSettings = config.ai_model_selection ?? DEFAULT_MODEL_SETTINGS
  const commonModelWorkflowCount = Object.values(MODEL_PIPELINES)
    .flatMap((pipeline) => pipeline.workflows)
    .filter((workflow) => !modelSettings.features[workflow]).length
  const commonSelection = modelSettings.default
  const commonModelSummary = PERSONAL_MODE ? "ChatGPT 구독 · 로컬 모델" : commonSelection.mode === "managed_default"
    ? t("AILS 단계별 기본값")
    : commonSelection.mode === "local"
      ? `${commonSelection.provider} · ${commonSelection.modelId}`
      : metadata.managedAiPolicy?.models.find((model) => model.canonical_id === commonSelection.modelId || model.id === commonSelection.modelId)?.name
        ?? modelSelectionPreview?.chatgpt_models?.find(model => `openai/${model.id}` === commonSelection.modelId)?.name
        ?? commonSelection.modelId
  const setConfigValue = (key: string, value: string | boolean | number) => {
    settings.setConfig((current) => ({ ...current, [key]: value }))
  }
  const modelSelectionProps = {
    config,
    localEnabled: LOCAL_AI_SETTINGS_ENABLED,
    preview: modelSelectionPreview,
    previewError: modelSelectionPreviewError,
    onChange: (value: NonNullable<typeof config.ai_model_selection>) => settings.setConfig((current) => ({ ...current, ai_model_selection: value })),
    onConfigValueChange: setConfigValue,
    policy: metadata.managedAiPolicy,
    policyError: metadata.managedAiPolicyError,
  }

  useEffect(() => {
    const policy = metadata.managedAiPolicy
    setModelSelectionPreview(null)
    setModelSelectionPreviewError(false)
    if (!active || (!PERSONAL_MODE && !policy)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void previewAiModelSelections(modelSettings, policy?.workflow_defaults ?? {}, config.ai_provider_settings)
        .then((result) => { if (!cancelled) setModelSelectionPreview(result) })
        .catch(() => { if (!cancelled) setModelSelectionPreviewError(true) })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, modelSettings, metadata.managedAiPolicy, config.ai_provider_settings, chatgptConnection])

  const localStatusLabel = (ready: boolean | undefined) => ready == null
    ? t("상태 확인 중")
    : ready ? t("준비 완료") : t("다운로드 필요")
  const voiceIsLocal = String(config.voice_agent_provider ?? "local") === "local"
  const savedProblemReviewMode = String(config.pdf_ocr_auto_review ?? "none")
  const problemReviewMode = PERSONAL_MODE && savedProblemReviewMode === "cloud" ? "none" : savedProblemReviewMode
  const sttProvider = String(config.stt_provider ?? "")
  const modelStageStatus: Partial<Record<ModelPipelineStageId, string>> = {
    summary_stt: sttProvider.includes("whisper.cpp")
      ? t("내 PC · {p0}", { p0: localStatusLabel(localModelsStatus?.video_stt?.ready) })
      : `${sttProvider || t("공급자 미선택")} · ${String(config.stt_model_name || "")}`,
    problem_review: problemReviewMode === "none"
      ? t("사용 안 함")
      : problemReviewMode === "local"
        ? t("내 PC · {p0}", { p0: localStatusLabel(localModelsStatus?.voice_agent?.ready) })
        : undefined,
    pdf_ocr: t("내 PC · {p0}", { p0: localStatusLabel(localModelsStatus?.ocr?.ready) }),
    voice_agent: voiceIsLocal
      ? t("내 PC · {p0}", { p0: localStatusLabel(localModelsStatus?.voice_agent?.ready) })
      : undefined,
    video_verification: config.video_summary_verification_enabled || (LOCAL_AI_SETTINGS_ENABLED && config.summary_verification_enabled)
      ? undefined
      : t("사용 안 함"),
  }
  const disabledModelWorkflows = [
    ...(problemReviewMode === "cloud" ? [] : ["problem_review"]),
    ...(voiceIsLocal ? ["voice_agent"] : []),
  ]
  const modelStageSettings: Partial<Record<ModelPipelineStageId, ReactNode>> = {
    /* @ails-feature:insight_book:start */
    insight_book: <InsightBookSettingsRow config={config} setConfig={settings.setConfig} />,
    /* @ails-feature:insight_book:end */
    summary_stt: (
      <>
        <SettingsRow
          label={t("음성 원문 인식 공급자")}
          control={(
            <select className={SETTINGS_SELECT_CLASS} value={sttProvider} onChange={(event) => {
              const provider = event.target.value
              const firstLocalModel = options?.whisper_cpp_model_options?.[0] ?? ""
              settings.setConfig((current) => ({
                ...current,
                stt_provider: provider,
                stt_model_name: provider === "Local (whisper.cpp Vulkan)" ? firstLocalModel : "",
              }))
            }}>
              {availableSttProviderOptions(options?.stt_provider_options ?? []).map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          )}
        />
        <SettingsRow
          label={t("음성 인식 모델")}
          control={sttProvider.includes("whisper.cpp") ? (
            <select className={SETTINGS_SELECT_CLASS} value={String(config.stt_model_name ?? "")} onChange={(event) => setConfigValue("stt_model_name", event.target.value)}>
              {(options?.whisper_cpp_model_options ?? []).map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          ) : (
            <Input aria-label={t("음성 인식 모델")} value={String(config.stt_model_name ?? "")} onChange={(event) => setConfigValue("stt_model_name", event.target.value)} />
          )}
        />
      </>
    ),
    video_summary: (
      <SummaryVerificationSettingsRows
        config={config}
        developerEnabled={LOCAL_AI_SETTINGS_ENABLED}
        preview={modelSelectionPreview}
        previewError={modelSelectionPreviewError}
        policy={metadata.managedAiPolicy}
        setConfig={settings.setConfig}
        setNotice={setNotice}
      />
    ),
    video_verification: (
      <SummaryVerificationSettingsRows
        config={config}
        developerEnabled={LOCAL_AI_SETTINGS_ENABLED}
        preview={modelSelectionPreview}
        previewError={modelSelectionPreviewError}
        policy={metadata.managedAiPolicy}
        setConfig={settings.setConfig}
        setNotice={setNotice}
      />
    ),
    problem_review: (
      <>
        <SettingsRow
          label={t("PDF 인식 후 문제 검수")}
          description={t("문제 검수를 끄거나 내 PC 또는 클라우드에서 실행합니다.")}
          control={(
            <select className={SETTINGS_SELECT_CLASS} value={problemReviewMode} onChange={(event) => setConfigValue("pdf_ocr_auto_review", event.target.value)}>
              <option value="none">{t("사용 안 함")}</option>
              <option value="local">{t("내 PC · 로컬 AI")}</option>
              {!PERSONAL_MODE && <option value="cloud">{t("클라우드 AI")}</option>}
            </select>
          )}
        />
        {problemReviewMode === "local" && <LocalProblemReviewModelRow config={config} onConfigValueChange={setConfigValue} />}
      </>
    ),
    pdf_ocr: (
      <SettingsRow
        label={t("PDF OCR 모델")}
        description={t("자동은 이 PC에서 측정한 권장 모델을 사용합니다.")}
        control={(
          <select className={SETTINGS_SELECT_CLASS} value={String(config.pdf_ocr_model_variant ?? "auto")} onChange={(event) => setConfigValue("pdf_ocr_model_variant", event.target.value)}>
            <option value="auto">{t("자동")}</option>
            <option value="tiny">Tiny</option>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
          </select>
        )}
      />
    ),
    voice_agent: (
      <>
        <SettingsRow
          label={t("보이스 모드 실행 위치")}
          control={(
            <select className={SETTINGS_SELECT_CLASS} value={voiceIsLocal ? "local" : "cloud"} onChange={(event) => setConfigValue("voice_agent_provider", event.target.value)}>
              <option value="local">{t("내 PC · 로컬 AI")}</option>
              <option value="cloud">{t("클라우드 AI")}</option>
            </select>
          )}
        />
        {voiceIsLocal && <LocalVoiceModelRow config={config} onConfigValueChange={setConfigValue} />}
      </>
    ),
  }

  return (
    <SettingsWorkspace
      active={active}
      isBusy={isBusy}
      onClose={workflows.close}
      onReset={() => void workflows.resetDefaults()}
    >
      {(settingsSectionId) => (
        <>
          {LOCAL_AI_SETTINGS_ENABLED && <AiProviderSettingsPanel
            active={settingsSectionId === "settings-ai"}
            value={config.ai_provider_settings}
            onConnectionChange={onChatGPTConnectionChange}
            onChange={value => settings.setConfig(current => ({ ...current, ai_provider_settings: value }))}
          />}


          {/* @ails-feature:summary.web_inputs:start */}
          <AccountSettingsSection
            account={account}
            active={settingsSectionId === "settings-account"}
            config={config}
            isBusy={isBusy}
            lmsPasswordDraft={settings.lmsPasswordDraft}
            onConfigValueChange={setConfigValue}
            onLmsPasswordChange={settings.setLmsPasswordDraft}
            onSaveLmsCredentials={() => void actions.saveLmsCredentials()}
          />
          {/* @ails-feature:summary.web_inputs:end */}
          <section
            className="grid gap-6"
            hidden={settingsSectionId !== "settings-models"}
            id="settings-models"
          >
            {!LOCAL_AI_SETTINGS_ENABLED && <SubscriptionUnavailableNotice config={config} onChange={settings.setConfig} />}
            {LOCAL_AI_SETTINGS_ENABLED && <LocalAiSettingsCard
              active={active && settingsSectionId === "settings-models"}
              onSelect={selected => settings.setConfig(current => applyLocalAiSelection(current, selected))}
            />}
            {!PERSONAL_MODE && <OpenRouterSearchSettings config={config} preview={modelSelectionPreview} onChange={value => settings.setConfig(current => ({ ...current, openrouter_web_search: value }))} />}
            <details className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--foreground)]">
                {t("공통 기본 모델")}
                <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                  {commonModelSummary} · {t("{p0}개 단계에서 사용", { p0: commonModelWorkflowCount })}
                </span>
              </summary>
              <div className="border-t border-[var(--border)] p-3">
                <AiModelSettingsCard {...modelSelectionProps} pipeline="common" />
              </div>
            </details>
            <nav aria-label={t("AI 작업 흐름")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(MODEL_PIPELINES) as ModelPipelineId[]).filter(pipeline => pipeline !== "insight" || INSIGHT_BOOK_ENABLED).map((pipeline) => (
                <button
                  aria-current={selectedModelPipeline === pipeline ? "page" : undefined}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${selectedModelPipeline === pipeline ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--foreground)]" : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                  key={pipeline}
                  onClick={() => setSelectedModelPipeline(pipeline)}
                  type="button"
                >
                  {t(MODEL_PIPELINES[pipeline].title)}
                </button>
              ))}
            </nav>
            <AiModelSettingsCard
              {...modelSelectionProps}
              disabledModelWorkflows={disabledModelWorkflows}
              key={selectedModelPipeline}
              pipeline={selectedModelPipeline}
              stageSettings={modelStageSettings}
              stageStatus={modelStageStatus}
            />
            {selectedModelPipeline === "summary" && (
              <SettingsCard title={t("영상 장면 탐지")}>
                <SettingsRow
                  label={t("화면 비교 간격 (초)")}
                  control={(
                    <Input
                      aria-label={t("화면 비교 간격 (초)")}
                      max={10}
                      min={0.25}
                      onChange={(event) => setConfigValue("video_frame_interval_seconds", event.target.value)}
                      step={0.25}
                      type="number"
                      value={String(config.video_frame_interval_seconds ?? 0.5)}
                    />
                  )}
                />
                <p className="text-xs text-[var(--muted-foreground)]">
                  {t("기본값 0.5초. 간격을 늘리면 비교할 화면이 줄지만 짧게 나타나는 화면을 놓칠 수 있습니다.")}
                </p>
              </SettingsCard>
            )}
            <SettingsCard title={t("로컬 모델 준비")}>
              <LocalModelsPrepareRow onNotice={setNotice} onStatusChange={setLocalModelsStatus} />
            </SettingsCard>
          </section>
          <section className="grid gap-6" hidden={settingsSectionId !== "settings-ai-behavior"} id="settings-ai-behavior">
            <VoiceSettingsCard config={config} onConfigValueChange={setConfigValue} />
            <ChatbotSettingsCard
              config={config}
              onConfigValueChange={setConfigValue}
            />
          </section>
          <section className="grid gap-6" hidden={settingsSectionId !== "settings-runtime"} id="settings-runtime">
            <BackgroundWorkSettingsCard
              config={config}
              onOpenQueue={actions.openBackgroundQueue}
              setConfig={settings.setConfig}
              setNotice={setNotice}
              status={settings.backgroundWorkStatus}
            />
            <StorageRuntimeSettingsCard
              config={config}
              developerSettings={(
                <>
                  {/* @ails-feature:developer_tools:start */}
                  <DeveloperTraceSettingsRows
                    config={config}
                    onDebugTraceChange={(checked) => {
                      setConfigValue("debug_trace_enabled", checked)
                      debugTrace.setOpen(checked)
                      setNotice(t("디버그 추적 설정을 변경했습니다. 변경사항은 자동 저장됩니다."))
                    }}
                    onPhoenixChange={(checked) => {
                      setConfigValue("phoenix_enabled", checked)
                      setNotice(checked ? t("Phoenix trace 전송을 켰습니다.") : t("Phoenix trace 전송을 껐습니다."))
                    }}
                    phoenixStatus={metadata.phoenixStatus}
                  />
                  {/* @ails-feature:developer_tools:end */}
                </>
              )}
              isBusy={isBusy}
              onConfigValueChange={setConfigValue}
              onPickPythonExecutable={() => void actions.pickPythonExecutable()}
              onPickSaveDirectory={() => void actions.pickSaveDirectory()}
              onRefreshPythonRuntime={() => void actions.refreshPythonRuntime()}
              runtime={settings.runtime}
            />
          </section>

          <PdfOcrSettingsSection
            active={active && settingsSectionId === "settings-pdf-ocr"}
            normalizeModelVariant={actions.normalizePdfOcrModelVariant}
            ocr={pdf.ocr}
            onBenchmark={actions.benchmarkPdfOcr}
          />
          <AppearanceSettingsSection
            active={settingsSectionId === "settings-appearance"}
            appearance={appearance}
            pdfView={pdf.view}
            setNotice={setNotice}
          />
          <SettingsSupportSections
            active={active}
            activeSection={settingsSectionId}
            debugTraceText={debugTrace.text}
            isBusy={isBusy}
            onCopyDebugTrace={() => void actions.copyDebugTrace()}
            onOpenDistributionLicenses={() => void actions.openDistributionLicenses()}
          />
        </>
      )}
    </SettingsWorkspace>
  )
}
