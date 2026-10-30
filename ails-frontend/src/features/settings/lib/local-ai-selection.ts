import type { AILSConfig } from "../../../lib/api"
import type { LocalAiSelection } from "../../../lib/api/local-ai.ts"

export function applyLocalAiSelection(config: AILSConfig, selected: LocalAiSelection): AILSConfig {
  const providers = config.ai_provider_settings ?? { default: "ails", features: {}, chatgpt_model: "" }
  const models = config.ai_model_selection ?? { default: { mode: "managed_default" }, features: {} }
  return {
    ...config,
    ai_provider_settings: { ...providers, features: { ...providers.features, chatbot: "ails" } },
    ai_model_selection: { ...models, features: { ...models.features,
      chatbot: { mode: "local", provider: "llama.cpp", modelId: selected.model_id },
    } },
  }
}
