import type { AILSConfig, PhoenixStatus } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { SettingsSwitch } from "./settings-layout.tsx"

export function DeveloperTraceSettingsRows({
  config,
  onDebugTraceChange,
  onPhoenixChange,
  phoenixStatus,
}: {
  config: AILSConfig
  onDebugTraceChange: (checked: boolean) => void
  onPhoenixChange: (checked: boolean) => void
  phoenixStatus: PhoenixStatus | null
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-6 border-t border-[var(--border)] px-5 py-4 first:border-t-0">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)]">{t("디버그 추적 활성화")}</div>
          <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">{t("로컬·클라우드 AI에 전달된 프롬프트와 출력을 기록합니다.")}</p>
        </div>
        <SettingsSwitch
          ariaLabel={t("디버그 추적 활성화")}
          checked={Boolean(config.debug_trace_enabled)}
          onCheckedChange={onDebugTraceChange}
        />
      </div>
      <div className="flex items-center justify-between gap-6 border-t border-[var(--border)] px-5 py-4 first:border-t-0">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)]">{t("Phoenix trace 전송")}</div>
          <p className="mt-0.5 text-xs leading-5 text-[var(--muted-foreground)]">
            {phoenixStatus?.sdk_available ? t("SDK 준비됨") : t("개발용 SDK 선택 설치")}
          </p>
        </div>
        <SettingsSwitch
          ariaLabel={t("Phoenix trace 전송")}
          checked={Boolean(config.phoenix_enabled)}
          onCheckedChange={onPhoenixChange}
        />
      </div>
    </>
  )
}
