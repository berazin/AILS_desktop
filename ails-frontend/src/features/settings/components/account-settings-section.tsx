import { PERSONAL_MODE } from "../../../edition.ts"
import { Loader2, RefreshCw, Save } from "lucide-react"

import { formatManagedCredit, type ManagedAccountController } from "../hooks/use-managed-account.ts"
import type { AILSConfig } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { SettingsCard, SettingsRow } from "./settings-layout.tsx"
import { Badge } from "../../../shared/ui/badge.tsx"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"

interface AccountSettingsSectionProps {
  account: ManagedAccountController
  active: boolean
  config: AILSConfig
  isBusy: (key: string) => boolean
  lmsPasswordDraft: string
  onConfigValueChange: (key: string, value: string | boolean | number) => void
  onLmsPasswordChange: (value: string) => void
  onSaveLmsCredentials: () => void
}

const SELECT_CLASS = "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 text-sm text-[var(--foreground)] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--brand)]"

export function AccountSettingsSection({
  account,
  active,
  config,
  isBusy,
  lmsPasswordDraft,
  onConfigValueChange,
  onLmsPasswordChange,
  onSaveLmsCredentials,
}: AccountSettingsSectionProps) {
  const {
    handleRefreshManagedCredits,
    managedAuthStatus,
    openManagedAuthDialog,
    openManagedCreditDialog,
  } = account

  return (
    <section className="grid gap-6" hidden={!active} id="settings-account">
      {!PERSONAL_MODE && <SettingsCard
        description={managedAuthStatus?.local_development ? t("서버 없이 사용하는 로컬 개발 계정을 관리합니다.") : t("AILS 클라우드 서비스 연동 및 크레딧 잔액을 관리합니다.")}
        title={t("AILS 계정")}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-[var(--muted-foreground)]">{t("로그인 계정")}</span>
              <span className="text-sm font-semibold text-[var(--foreground)]">
                {managedAuthStatus?.authenticated ? managedAuthStatus.email : t("로그인되어 있지 않습니다.")}
              </span>
            </div>
            <Button
              className="rounded bg-[var(--sidebar)] px-3 py-1 text-xs font-bold text-[var(--foreground)] hover:bg-[var(--muted)]"
              data-managed-account-button="true"
              onClick={openManagedAuthDialog}
              title={managedAuthStatus?.authenticated ? managedAuthStatus.email : t("AILS 계정 로그인")}
              type="button"
              variant="outline"
            >
              {managedAuthStatus?.authenticated ? managedAuthStatus.email : t("로그인")}
            </Button>
          </div>

          {managedAuthStatus?.authenticated && !managedAuthStatus.local_development && (
            <div className="flex items-center justify-between border-t border-[var(--border)] pt-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-[var(--muted-foreground)]">{t("사용 가능 크레딧")}</span>
                <span className="text-sm font-semibold text-[var(--foreground)]">
                  {formatManagedCredit(managedAuthStatus.credits?.available_microusd)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded bg-[var(--sidebar)] px-3 py-1 text-xs font-bold text-[var(--foreground)] hover:bg-[var(--muted)]"
                  data-managed-credit-balance="true"
                  onClick={() => void openManagedCreditDialog()}
                  title={t("사용 가능 {p0} · 예약 {p1} · 미정산 {p2}", { p0: formatManagedCredit(managedAuthStatus.credits?.available_microusd), p1: formatManagedCredit(managedAuthStatus.credits?.reserved_microusd), p2: formatManagedCredit(managedAuthStatus.credits?.debt_microusd) })}
                  type="button"
                >
                  {t("크레딧 ")}{formatManagedCredit(managedAuthStatus.credits?.available_microusd)}
                </button>
                <Button
                  onClick={() => void handleRefreshManagedCredits()}
                  size="sm"
                  title={t("잔액 새로고침")}
                  type="button"
                  variant="ghost"
                >
                  <RefreshCw className={cn("size-3.5", isBusy("managed-credit-refresh") && "animate-spin")} />
                  <span className="text-xs">{t("잔액 새로고침")}</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsCard>}
      <SettingsCard
        description={t("앱 표시 언어와 AI 생성물(요약·챗봇·퀴즈·채점), PDF 번역, OCR, STT의 언어를 함께 전환합니다.")}
        title="Language"
      >
        <SettingsRow
          control={(
            <select
              className={SELECT_CLASS}
              onChange={(event) => onConfigValueChange("language", event.target.value)}
              value={String(config.language ?? "korean")}
            >
              <option value="korean">{t("한국어")}</option>
              <option value="english">English</option>
              <option value="japanese">日本語</option>
              <option value="chinese">中文</option>
            </select>
          )}
          description={t("선택 즉시 앱 화면 문구가 바뀌며, 저장 후 AI 답변·번역·OCR·STT 언어에도 적용됩니다.")}
          label="Language"
        />
      </SettingsCard>
      <SettingsCard
        actions={<Badge>{config.lms_password_saved ? t("비밀번호 저장됨") : t("비밀번호 미저장")}</Badge>}
        description={t("e-class VOD 작업 추가 시 Windows 기본 브라우저에서 로그인을 진행합니다.")}
        title={t("LMS 계정")}
      >
        <SettingsRow
          control={(
            <Input
              onChange={(event) => onConfigValueChange("lms_username", event.target.value)}
              placeholder={t("학번 또는 LMS ID")}
              value={String(config.lms_username ?? "")}
            />
          )}
          label="LMS ID"
        />
        <SettingsRow
          control={(
            <Input
              onChange={(event) => onLmsPasswordChange(event.target.value)}
              placeholder={config.lms_password_saved ? t("새 비밀번호를 입력하면 갱신됩니다") : t("LMS 비밀번호")}
              type="password"
              value={lmsPasswordDraft}
            />
          )}
          label="LMS Password"
        />
        <div className="flex items-center justify-end border-t border-[var(--border)] px-5 py-4">
          <Button
            disabled={isBusy("lms-credentials-save")}
            onClick={onSaveLmsCredentials}
            size="sm"
            variant="outline"
          >
            {isBusy("lms-credentials-save") ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {t("저장")}
          </Button>
        </div>
      </SettingsCard>
    </section>
  )
}
