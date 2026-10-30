import { PERSONAL_MODE } from "../../../edition.ts"
import { LOCAL_AI_SETTINGS_ENABLED } from "../../../edition.ts"
import { useEffect, useState } from "react"
import { getManagedChatbotCatalog, type AILSConfig, type ModelOptionsPayload, type ManagedChatbotCatalog } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { managedChatbotSelection, selectedCatalogModel } from "../lib/chat-model-catalog.ts"
import { useChatGPTComposerModels } from "./use-chatgpt-composer-models.ts"
type ComposerModel = { id: string; name: string; available: boolean; note?: string }

export function useChatComposerModels(config: AILSConfig, options: ModelOptionsPayload | null, open: boolean, active = true) {
  const chatgpt = useChatGPTComposerModels(active && open)
  const [managedCatalog, setManagedCatalog] = useState<ManagedChatbotCatalog | null>(null)
  const [catalogError, setCatalogError] = useState("")
  const [catalogLoading, setCatalogLoading] = useState(false)
  const selection = config.ai_model_selection?.features?.chatbot ?? config.ai_model_selection?.default
  const legacy = config.ai_provider_settings
  const legacyChatGPT = PERSONAL_MODE || (legacy?.features.chatbot && legacy.features.chatbot !== "default" ? legacy.features.chatbot : legacy?.default) === "chatgpt"
  const selectedId = PERSONAL_MODE ? (selection?.mode === "local" ? `local:${selection.provider}:${selection.modelId}` : selection?.mode === "managed" && selection.modelId.startsWith("openai/") ? `chatgpt:${selection.modelId.slice(7)}` : legacy?.chatgpt_model ? `chatgpt:${legacy.chatgpt_model}` : "managed_default") : !LOCAL_AI_SETTINGS_ENABLED && legacyChatGPT ? "subscription-unavailable" : legacyChatGPT && legacy?.chatgpt_model ? `chatgpt:${legacy.chatgpt_model}`
    : selection?.mode === "managed" ? selection.modelId
    : selection?.mode === "local" ? `local:${selection.provider}:${selection.modelId}`
    : legacyChatGPT && legacy?.chatgpt_model ? `chatgpt:${legacy.chatgpt_model}` : "managed_default"
  const managedId = PERSONAL_MODE ? null : managedChatbotSelection(config.ai_model_selection, config.ai_provider_settings)
  useEffect(() => {
    // Hidden quick-chat controls keep their selection state without fetching
    // or polling a catalog that the home workspace does not need.
    if (!active || PERSONAL_MODE || (!open && managedId === null)) return
    let cancelled = false
    const refresh = () => {
      setCatalogLoading(true)
      void getManagedChatbotCatalog().then(result => { if (!cancelled) { setManagedCatalog(result); setCatalogError("") } })
        .catch(failure => { if (!cancelled) {
          setCatalogError(failure instanceof Error ? failure.message : String(failure))
          setManagedCatalog(current => current && Date.parse(current.expires_at) > Date.now() ? current : null)
        } })
        .finally(() => { if (!cancelled) setCatalogLoading(false) })
    }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [active, open, managedId])
  const models = new Map<string, ComposerModel>([
    ["managed_default", { id: "managed_default", name: t("기본 모델"), available: true }],
    ...(managedCatalog?.models ?? []).map(model => [model.id, { id: model.id, name: model.name, available: model.available }] as const),
  ])
  for (const model of chatgpt.models) {
    const id = `chatgpt:${model.id}`
    models.set(id, { id, name: model.name, available: true })
  }
  if (!models.has(selectedId)) models.set(selectedId, { id: selectedId,
    name: selectedId === "subscription-unavailable" ? t("이전 구독 모델을 사용할 수 없습니다. 모델을 다시 선택해 주세요.") : selectedId.startsWith("chatgpt:") ? `${selectedId.slice("chatgpt:".length)} · ChatGPT`
      : selection?.mode === "local" ? `${selection.modelId} · ${selection.provider}` : selectedId, available: false, note: t("설정에서 선택한 모델") })
  const selectedManagedModel = managedId === null || !managedCatalog ? undefined : selectedCatalogModel(managedCatalog, managedId)
  const storedLocalName = options?.chatbot_agent_models?.find(model => `local:llama.cpp:${model.id}` === selectedId)?.name
  return { models: [...models.values()], selectedId, selectedName: storedLocalName ?? selectedManagedModel?.name ?? models.get(selectedId)!.name,
    error: catalogError, loading: catalogLoading, managedCatalog, managedId, selectedManagedModel,
    chatgptLoading: chatgpt.loading, chatgptError: chatgpt.error, reloadChatGPT: chatgpt.reload }
}
