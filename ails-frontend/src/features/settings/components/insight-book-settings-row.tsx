import type { Dispatch, SetStateAction } from "react"

import type { AILSConfig } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { SETTINGS_SELECT_CLASS, SettingsRow } from "./settings-layout.tsx"

export function InsightBookSettingsRow({ config, setConfig }: {
  config: AILSConfig
  setConfig: Dispatch<SetStateAction<AILSConfig>>
}) {
  return (
    <SettingsRow
      label={t("Insight Book 추론 수준")}
      description={t("모든 Insight Book AI 단계에 적용합니다. 지원 수준은 모델마다 다르며, 기본값은 AILS 정책 또는 개인 모델의 기본 설정을 따릅니다.")}
      control={<select
        aria-label={t("Insight Book 추론 수준")}
        className={SETTINGS_SELECT_CLASS}
        value={String(config.insight_book_reasoning_effort ?? "default")}
        onChange={(event) => setConfig((current) => ({ ...current, insight_book_reasoning_effort: event.target.value }))}
      >
        <option value="default">{t("기본값")}</option>
        {["none", "minimal", "low", "medium", "high", "xhigh", "max"].map((effort) => <option key={effort} value={effort}>{effort}</option>)}
      </select>}
    />
  )
}
