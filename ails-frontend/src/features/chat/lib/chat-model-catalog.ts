import type { ManagedChatbotCatalog, ManagedChatbotModel } from "../../../lib/api/chatbot-catalog.ts"
import type { ModelSettings } from "../../../lib/api/core.ts"
import type { AiProviderSettings } from "../../../lib/api/chatgpt.ts"
import { CHAT_REASONING_LEVELS } from "./chat-reasoning-levels.ts"

export function managedChatbotSelection(settings?: ModelSettings, providers?: AiProviderSettings) {
  const selection = settings?.features.chatbot ?? settings?.default
  if (selection?.mode === "local") return null
  if (providers?.features.chatbot === "chatgpt") return null
  const provider = providers?.features.chatbot && providers.features.chatbot !== "default" ? providers.features.chatbot : providers?.default
  if (provider === "chatgpt") return null
  return selection?.mode === "managed" ? selection.modelId : "managed_default"
}
export function selectedCatalogModel(catalog: ManagedChatbotCatalog, id: string) {
  const target = id === "managed_default" ? catalog.default_model_id : id
  return catalog.models.find(model => model.id === target || model.aliases.includes(target ?? ""))
}
export function modelReasoningChoices(model?: ManagedChatbotModel): readonly (readonly [string, string])[] {
  const labels = new Map<string, string>([...CHAT_REASONING_LEVELS, ["enabled", "켬"], ["disabled", "끔"]])
  const order = ["disabled", "none", "minimal", "low", "medium", "high", "xhigh", "max", "enabled"]
  return [["default", "기본"], ...(model?.reasoning.values ?? []).filter(value => labels.has(value)
    && !(model?.reasoning.mandatory && ["none", "disabled"].includes(value))).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(value => [value, labels.get(value)!] as const)]
}
export interface CatalogFilters {
  query: string; developer: string; minContext: number; maxCost: number | null
  tools: boolean; vision: boolean; reasoning: boolean; experimental: boolean
}
export function filterChatbotModels(models: ManagedChatbotModel[], tab: "recommended" | "value" | "all", filters: CatalogFilters) {
  const query = filters.query.trim().toLocaleLowerCase()
  const result = models.filter(model => model.available && (tab !== "recommended" || model.recommended)
    && (tab !== "value" || model.estimated_request_cost !== null)
    && (!model.experimental || (tab === "all" && filters.experimental))
    && (!query || `${model.name} ${model.id} ${model.developer}`.toLocaleLowerCase().includes(query))
    && (!filters.developer || model.developer === filters.developer)
    && (!filters.minContext || (model.context_length ?? 0) >= filters.minContext)
    && (filters.maxCost === null || (model.estimated_request_cost !== null && model.estimated_request_cost <= filters.maxCost))
    && (!filters.tools || model.tools === true) && (!filters.vision || model.vision === true)
    && (!filters.reasoning || model.reasoning.values.length > 0 || model.reasoning.mandatory === true))
  if (tab === "value") return result.sort((a, b) => a.estimated_request_cost! - b.estimated_request_cost! || a.name.localeCompare(b.name))
  if (tab === "recommended") return result.sort((a, b) => Number(b.recommendation_basis === "verified") - Number(a.recommendation_basis === "verified"))
  return result
}
