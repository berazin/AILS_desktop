import { ClipboardList, FileText, Loader2 } from "lucide-react"

import { t } from "../../../lib/i18n.ts"
import { PrivacyAISettingsPanel } from "./ai-compliance.tsx"
/* @ails-feature:user_memory:start */
import { MemorySettingsPanel } from "./memory-settings-panel.tsx"
/* @ails-feature:user_memory:end */
import { SettingsCard } from "./settings-layout.tsx"
import type { SettingsSectionId } from "./settings-workspace.tsx"
import { UpdateSettingsPanel } from "./update-settings-panel.tsx"
import { Button } from "../../../shared/ui/button.tsx"

interface SettingsSupportSectionsProps {
  active: boolean
  activeSection: SettingsSectionId
  debugTraceText: string
  isBusy: (key: string) => boolean
  onCopyDebugTrace: () => void
  onOpenDistributionLicenses: () => void
}

export function SettingsSupportSections({
  active,
  activeSection,
  debugTraceText,
  isBusy,
  onCopyDebugTrace,
  onOpenDistributionLicenses,
}: SettingsSupportSectionsProps) {
  return (
    <>
      {/* @ails-feature:developer_tools:start */}
      <div hidden={activeSection !== "settings-runtime"}>
        <SettingsCard
          actions={(
            <Button disabled={isBusy("copy-debug")} onClick={onCopyDebugTrace} size="sm" variant="outline">
              {isBusy("copy-debug") ? <Loader2 className="animate-spin" size={14} /> : <ClipboardList size={14} />}
              {t("전체 복사")}
            </Button>
          )}
          description={t("로컬·클라우드 AI에 전달된 프롬프트와 출력을 확인합니다.")}
          title={t("디버그 추적")}
        >
          <div className="p-4">
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--muted)] p-3 font-mono text-xs leading-5 text-[var(--muted-foreground)]">
              {debugTraceText || t("디버그 추적 데이터가 없습니다.")}
            </div>
          </div>
        </SettingsCard>
      </div>
      {/* @ails-feature:developer_tools:end */}
      {/* @ails-feature:user_memory:start */}
      <div hidden={activeSection !== "settings-memory"} id="settings-memory">
        {active && activeSection === "settings-memory" && <MemorySettingsPanel />}
      </div>
      {/* @ails-feature:user_memory:end */}
      <div hidden={activeSection !== "settings-privacy-ai"}>
        {active && activeSection === "settings-privacy-ai" && <PrivacyAISettingsPanel />}
      </div>
      <section
        className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5"
        hidden={activeSection !== "settings-licenses"}
        id="settings-licenses"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t("오픈소스 및 제3자 라이선스")}</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              {t("이 배포판에 포함된 구성요소의 원문 라이선스, Chromium 고지 및 배포 inventory를 확인합니다.")}
            </p>
          </div>
          <Button disabled={isBusy("open-licenses")} onClick={onOpenDistributionLicenses} size="sm" variant="outline">
            {isBusy("open-licenses") ? <Loader2 className="animate-spin" size={14} /> : <FileText size={14} />}
            {t("라이선스 폴더 열기")}
          </Button>
        </div>
      </section>
      <div data-ails-update-view={activeSection === "settings-update" || undefined} hidden={activeSection !== "settings-update"}>
        {active && activeSection === "settings-update" && <UpdateSettingsPanel />}
      </div>
    </>
  )
}
