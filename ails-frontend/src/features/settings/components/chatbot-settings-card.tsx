import { PERSONAL_MODE } from "../../../edition.ts"
import type { AILSConfig } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { SettingsCard, SettingsSwitch } from "./settings-layout.tsx"

export function ChatbotSettingsCard({
  config,
  onConfigValueChange,
}: {
  config: AILSConfig
  onConfigValueChange: (key: string, value: string | boolean) => void
}) {
  if (PERSONAL_MODE) return null
  return (
    <SettingsCard
      description={t("에이전트 대화와 추론에 사용되는 모델 동작을 조정합니다.")}
      title={t("챗봇")}
    >
      <div className="flex items-center justify-between gap-6 border-t border-[var(--border)] px-5 py-4 first:border-t-0">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)]">{t("ZDR 요청")}</div>
          <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">
            {t("지원되는 공급자에 Zero Data Retention을 요청합니다. 기본값은 해제입니다.")}
          </p>
        </div>
        <SettingsSwitch
          ariaLabel={t("ZDR 요청")}
          checked={Boolean(config.chatbot_zdr_enabled)}
          onCheckedChange={(checked) => onConfigValueChange("chatbot_zdr_enabled", checked)}
        />
      </div>
    </SettingsCard>
  )
}
