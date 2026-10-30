import type { AILSConfig } from "../../../lib/api"

const subscription = (value: unknown) => {
  if (!value || typeof value !== "object") return false
  const selection = value as Record<string, unknown>
  return ["codex", "chatgpt"].includes(String(selection.mode))
    || /^(codex:|chatgpt:|chatgpt-plan:)/i.test(String(selection.modelId ?? ""))
    || /^(codex|chatgpt)$/i.test(String(selection.provider ?? ""))
}

export function SubscriptionUnavailableNotice({ config, onChange }: { config: AILSConfig; onChange: (config: AILSConfig) => void }) {
  const providers = config.ai_provider_settings
  const models = config.ai_model_selection
  if (providers?.default !== "chatgpt" && !Object.values(providers?.features ?? {}).includes("chatgpt")
      && !subscription(models?.default) && !Object.values(models?.features ?? {}).some(subscription)) return null
  return <div role="alert" className="rounded-xl border border-[var(--border)] p-4 text-sm">
    <p>이전 구독 연결 선택은 이 배포판에서 사용할 수 없습니다. AI 모델 설정을 다시 선택해 주세요. 다른 유료 모델로 자동 전환하지 않습니다.</p>
    <button type="button" className="mt-2 underline" onClick={() => onChange({ ...config,
      ai_provider_settings: { default: "ails", features: {}, chatgpt_model: providers?.chatgpt_model ?? "" },
      ai_model_selection: { default: subscription(models?.default) ? { mode: "managed_default" } : models?.default ?? { mode: "managed_default" },
        features: Object.fromEntries(Object.entries(models?.features ?? {}).filter(([, value]) => !subscription(value))) },
    })}>구독 선택을 해제하고 AI 모델 설정 사용</button>
  </div>
}
