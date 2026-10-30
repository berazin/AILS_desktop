import { PERSONAL_MODE } from "../../../edition.ts"
import { t } from "../../../lib/i18n.ts"
import type { AILSConfig } from "../../../lib/api"
import { useChatGPTComposerModels } from "../hooks/use-chatgpt-composer-models.ts"
import { ChatGPTOptionsPopover } from "./chatgpt-options-popover.tsx"

export function ChatGPTPlanIndicator({ model, busy = false }: { model?: string; onError: (message: string) => void; busy?: boolean }) {
  return <div className="mb-2 min-w-0 text-xs text-[var(--muted-foreground)]">
    <div className="flex flex-wrap items-center gap-2">
    <span className="min-w-0 [overflow-wrap:anywhere]">{t("ChatGPT 구독 사용")} · {model || t("AI 설정에서 모델 선택 필요")}</span>
    <ChatGPTOptionsPopover busy={busy} />
    </div>
  </div>
}

export function ChatGPTPlanIndicatorForConfig({ config, ...props }: { config: AILSConfig; onError: (message: string) => void; busy?: boolean }) {
  const settings = config.ai_provider_settings
  const provider = settings?.features.chatbot && settings.features.chatbot !== "default" ? settings.features.chatbot : settings?.default
  const selection = config.ai_model_selection?.features?.chatbot ?? config.ai_model_selection?.default
  const modelId = selection && selection.mode !== "managed_default" ? selection.modelId : ""
  const candidate = selection?.mode === "local" && selection.provider === "OpenAI" ? modelId.replace(/^openai\//, "")
    : (selection?.mode === "managed" || (selection?.mode === "local" && ["OpenRouter", "Vercel AI Gateway"].includes(selection.provider))) && modelId.startsWith("openai/") ? modelId.slice(7) : ""
  const catalog = useChatGPTComposerModels(provider !== "chatgpt" && Boolean(candidate))
  const automatic = candidate && catalog.models.some(model => model.id === candidate)
  return (PERSONAL_MODE && selection?.mode !== "local") || provider === "chatgpt" || automatic ? <ChatGPTPlanIndicator model={automatic ? candidate : settings?.chatgpt_model} {...props} /> : null
}
