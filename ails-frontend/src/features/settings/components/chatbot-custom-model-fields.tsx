import { t } from "../../../lib/i18n.ts"
import { Input } from "../../../shared/ui/input.tsx"

export function ChatbotCustomModelFields({ modelName, endpoint, onModelNameChange, onEndpointChange }: {
  modelName: string
  endpoint: string
  onModelNameChange: (value: string) => void
  onEndpointChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-xs text-[var(--muted-foreground)]">
        <span>{t("모델명")}</span>
        <Input
          aria-label={t("챗봇 Custom 모델명")}
          autoCapitalize="none"
          placeholder={t("모델 ID")}
          spellCheck={false}
          value={modelName}
          onChange={(event) => onModelNameChange(event.target.value)}
        />
      </label>
      <label className="block space-y-1 text-xs text-[var(--muted-foreground)]">
        <span>{t("주소")}</span>
        <Input
          aria-label={t("챗봇 Custom 모델 주소")}
          placeholder="https://example.com/v1/chat/completions"
          spellCheck={false}
          type="url"
          value={endpoint}
          onChange={(event) => onEndpointChange(event.target.value)}
        />
      </label>
    </div>
  )
}
