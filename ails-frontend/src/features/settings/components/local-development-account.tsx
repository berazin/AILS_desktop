import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"
import { t } from "../../../lib/i18n.ts"
import type { ManagedAccountController } from "../hooks/use-managed-account.ts"

export function LocalDevelopmentAccount({ account, isBusy }: {
  account: ManagedAccountController
  isBusy: (key: string) => boolean
}) {
  const authenticated = account.managedAuthStatus?.authenticated
  return <div className="mt-5 grid gap-4">
    <div>
      <h3 className="text-xl font-bold">{t("로컬 개발 계정")}</h3>
      <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
        {t("서버 없이 사용하는 개발용 로그인입니다. 이름과 비밀번호에 아무 값이나 입력해도 됩니다.")}
      </p>
    </div>
    {authenticated ? <>
      <p className="font-semibold">{account.managedAuthStatus?.display_name}</p>
      <p className="text-xs text-[var(--muted-foreground)]">{t("AI 답변은 AI 설정에서 연결한 ChatGPT 계정을 사용합니다.")}</p>
      <Button disabled={isBusy("managed-auth-logout")} onClick={() => void account.handleManagedAuth("logout")} type="button" variant="outline">{t("로그아웃")}</Button>
    </> : <>
      <label className="grid gap-1 text-xs font-medium">
        {t("사용자 이름")}
        <Input autoComplete="off" onChange={event => account.setLocalDevelopmentName(event.target.value)}
          placeholder={t("아무 이름이나 입력")} type="text" value={account.localDevelopmentName} />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        {t("비밀번호")}
        <Input autoComplete="off" onChange={event => account.setManagedAuthPassword(event.target.value)}
          placeholder={t("아무 값이나 입력")} type="password" value={account.managedAuthPassword} />
      </label>
      <Button disabled={isBusy("managed-auth-login")} onClick={() => void account.handleManagedAuth("login")} type="button">
        {isBusy("managed-auth-login") ? t("로그인 중...") : t("로그인")}
      </Button>
    </>}
  </div>
}
