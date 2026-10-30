import type { AILSConfig } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { SETTINGS_SELECT_CLASS, SettingsRow } from "./settings-layout.tsx"

type Props = {
  config: AILSConfig
  onConfigValueChange: (key: string, value: string) => void
}

export function LocalProblemReviewModelRow({ config, onConfigValueChange }: Props) {
  return <SettingsRow
    label={t("로컬 문제 검수 모델")}
    control={(
      <select className={SETTINGS_SELECT_CLASS} value={String(config.local_problem_review_model ?? "auto")} onChange={(event) => onConfigValueChange("local_problem_review_model", event.target.value)}>
        <option value="auto">{t("자동 — 외장 GPU VRAM 10GB 이상은 8B, 그 외는 4B")}</option>
        <option value="qwen3-4b-instruct-2507-q4-k-m">{t("Qwen3 4B — 낮은 메모리 사용")}</option>
        <option value="qwen3-8b-q4-k-m">{t("Qwen3 8B — 높은 교정 정확도")}</option>
      </select>
    )}
  />
}

export function LocalVoiceModelRow({ config, onConfigValueChange }: Props) {
  return <SettingsRow
    label={t("로컬 보이스·AI Assist 모델")}
    description={t("클라우드 보이스 모드에는 적용되지 않습니다.")}
    control={(
      <select className={SETTINGS_SELECT_CLASS} value={String(config.local_voice_agent_model ?? "auto")} onChange={(event) => onConfigValueChange("local_voice_agent_model", event.target.value)}>
        <option value="auto">{t("자동 — 외장 GPU VRAM 10GB 이상은 8B, 그 외는 4B")}</option>
        <option value="qwen3-4b-instruct-2507-q4-k-m">{t("Qwen3 4B — 낮은 메모리 사용")}</option>
        <option value="qwen3-8b-q4-k-m">{t("Qwen3 8B — 높은 추론 품질")}</option>
      </select>
    )}
  />
}
