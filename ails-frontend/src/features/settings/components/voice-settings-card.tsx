import { PERSONAL_MODE } from "../../../edition.ts"
import type { AILSConfig } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { MicTestPanel } from "../../voice/components/mic-test-panel.tsx"
import { SETTINGS_SELECT_CLASS, SettingsCard, SettingsRow } from "./settings-layout.tsx"

export function VoiceSettingsCard({
  config,
  onConfigValueChange,
}: {
  config: AILSConfig
  onConfigValueChange: (key: string, value: string | number) => void
}) {
  return (
    <SettingsCard
      description={t("음성 명령 처리 방식과 발화 감지를 설정합니다.")}
      title={t("보이스 모드")}
    >
      <SettingsRow
        control={(
          <select
            className={SETTINGS_SELECT_CLASS}
            onChange={(event) => onConfigValueChange("ai_assist_cloud_fallback_policy", event.target.value)}
            value={String(config.ai_assist_cloud_fallback_policy ?? "manual")}
          >
            <option value="manual">{t(PERSONAL_MODE ? "수동 — ChatGPT 사용 전 직접 선택" : "수동 — 비용 발생 전 직접 선택")}</option>
            <option value="automatic">{t("자동 — 로컬 AI가 필요하다고 판단할 때 보강")}</option>
          </select>
        )}
        label={t("AI Assist 클라우드 보강")}
      />
      <SettingsRow
        control={(
          <input
            aria-label={t("발화 감지 민감도")}
            className="w-full accent-[var(--brand)]"
            max={0.9}
            min={0.05}
            onChange={(event) => onConfigValueChange("voice_vad_threshold", Number(event.target.value))}
            step={0.05}
            type="range"
            value={Number(config.voice_vad_threshold ?? 0.3)}
          />
        )}
        description={t("값이 낮을수록 작은·먼 소리도 문장으로 확정합니다. 저장 즉시 실행 중인 보이스 세션에도 적용됩니다.")}
        label={(
          <span className="flex items-center justify-between">
            {t("발화 감지 민감도")}
            <span className="tabular-nums text-[var(--muted-foreground)]">{Number(config.voice_vad_threshold ?? 0.3).toFixed(2)}</span>
          </span>
        )}
        layout="stacked"
      />
      <p className="border-t border-[var(--border)] px-5 py-4 text-xs leading-5 text-[var(--muted-foreground)]">
        {PERSONAL_MODE ? "음성 인식은 Windows STT 또는 로컬 Sherpa·Whisper를 사용합니다. 로컬 명령 해석은 llama.cpp를 사용하며, 클라우드 명령 해석은 ChatGPT 구독 사용량을 사용합니다. ChatGPT가 오디오를 전사하는 기능은 아닙니다." : t("MSIX 앱이 온라인이면 Windows 연속 STT를 사용합니다. 비-MSIX 앱이나 오프라인 환경에서는 고사양 PC는 Sherpa 실시간 인식 후 사양별 Whisper로 최종 교정하는 2-pass를 사용하고, 저사양 PC는 Whisper만 사용합니다. CPU 전용 PC의 Whisper 모델은 Base입니다. 로컬 명령 해석은 별도 Ollama 없이 AILS의 llama.cpp Vulkan으로 동작합니다. 자동 선택 시 외장 GPU 전용 메모리가 충분하면 Qwen3 8B, 그 외에는 Qwen3 4B를 사용합니다. 클라우드 선택은 실행 전 예상 비용·시간을 확인하고, 관리자 지정 모델과 AILS 크레딧을 사용합니다. 자동 폴백은 없습니다.")}
      </p>
      <div className="border-t border-[var(--border)] px-5 py-4">
        <MicTestPanel />
      </div>
    </SettingsCard>
  )
}
