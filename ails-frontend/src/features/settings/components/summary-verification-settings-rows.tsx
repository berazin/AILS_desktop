import { PERSONAL_MODE } from "../../../edition.ts"
import type { Dispatch, SetStateAction } from "react"

import type { AILSConfig, ManagedAiPolicyResponse, ModelSelectionPreviewResponse } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { SETTINGS_SELECT_CLASS, SettingsRow, SettingsSwitch } from "./settings-layout.tsx"

export function SummaryVerificationSettingsRows({
  config,
  developerEnabled,
  setConfig,
  setNotice,
}: {
  config: AILSConfig
  developerEnabled: boolean
  preview: ModelSelectionPreviewResponse | null
  previewError: boolean
  policy: ManagedAiPolicyResponse | null
  setConfig: Dispatch<SetStateAction<AILSConfig>>
  setNotice: (message: string) => void
}) {
  return (
    <>
      {developerEnabled && <SettingsRow
        label={t("단일 정리 작업에도 검증")}
        description={t("선택한 정리 모델로 작성하고 영상 근거 검증 모델이 원문 근거와 기술 정확성을 검토합니다. 오류 의심·판정 불가를 정리본에 표시합니다.")}
        control={<SettingsSwitch
          ariaLabel={t("단일 정리 작업에도 검증")}
          checked={Boolean(config.summary_verification_enabled)}
          onCheckedChange={(enabled) => {
            setConfig((current) => ({ ...current, summary_verification_enabled: enabled }))
            setNotice(enabled
              ? t("선택한 모델로 정리와 근거 검증을 사용합니다.")
              : t("기존 선택 모델 기반 요약을 사용합니다."))
          }}
        />}
      />}
      <SettingsRow
        label={t("동영상 정리에도 검증 적용")}
        description={t("정리본에 적힌 기술 개념만 검토합니다. 누락 검사는 하지 않으며, 끄면 검증 모델을 호출하지 않습니다.")}
        control={<SettingsSwitch
          ariaLabel={t("동영상 정리에도 검증 적용")}
          checked={Boolean(config.video_summary_verification_enabled)}
          onCheckedChange={(enabled) => {
            setConfig((current) => ({ ...current, video_summary_verification_enabled: enabled }))
            setNotice(enabled
              ? t("동영상 정리본 검증을 사용합니다.")
              : t("동영상 정리본 검증을 사용하지 않습니다."))
          }}
        />}
      />
      {!PERSONAL_MODE && <p className="px-5 py-3 text-xs text-[var(--muted-foreground)]">
        웹 검색은 AI 모델의 OpenRouter 웹 검색 설정을 사용합니다. 구형 별도 서버 검색키 방식은 지원하지 않습니다.
      </p>}
      {developerEnabled && <SettingsRow
        label={t("검증 추론 수준")}
        control={<select
          className={SETTINGS_SELECT_CLASS}
          value={String(config.summary_verification_reasoning_effort ?? "medium")}
          onChange={(event) => setConfig((current) => ({ ...current, summary_verification_reasoning_effort: event.target.value }))}
        >
          {["none", "minimal", "low", "medium", "high"].map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </select>}
      />}
    </>
  )
}
