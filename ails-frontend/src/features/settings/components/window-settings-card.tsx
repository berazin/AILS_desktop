import { t } from "../../../lib/i18n.ts"
import { SettingsCard, SettingsRow, SettingsSwitch } from "./settings-layout.tsx"

export function WindowSettingsCard({ fullscreenOnMaximize, setFullscreenOnMaximize }: {
  fullscreenOnMaximize: boolean
  setFullscreenOnMaximize: (enabled: boolean) => void
}) {
  return <SettingsCard title={t("창 동작")} description={t("창의 최대화 버튼과 전체화면 동작을 설정합니다.")}>
    <SettingsRow label={t("최대화 시 전체화면 전환")}
      description={t("최대화(ㅁ) 버튼이나 제목 표시줄을 더블 클릭하면 전체화면으로 전환합니다. Esc로 일반 화면에 돌아옵니다.")}
      control={<div className="flex justify-end"><SettingsSwitch ariaLabel={t("최대화 시 전체화면 전환")}
        checked={fullscreenOnMaximize} onCheckedChange={setFullscreenOnMaximize} /></div>}
    />
  </SettingsCard>
}
