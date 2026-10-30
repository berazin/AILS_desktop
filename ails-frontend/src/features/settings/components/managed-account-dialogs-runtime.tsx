import { Eye, Loader2, X } from "lucide-react"

import { Badge } from "../../../shared/ui/badge.tsx"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { t } from "../../../lib/i18n.ts"
import { cn } from "../../../lib/utils.ts"
import { LocalDevelopmentAccount } from "./local-development-account.tsx"
import {
  formatManagedCredit,
  formatManagedPlanPrice,
  type ManagedAccountController,
} from "../hooks/use-managed-account.ts"

type ManagedAccountDialogsProps = {
  account: ManagedAccountController
  isBusy: (key: string) => boolean
}

export function ManagedAccountDialogs({ account, isBusy }: ManagedAccountDialogsProps) {
  const {
    advanceManagedSignup,
    beginManagedPin,
    cancelManagedBrowserLogin,
    closeManagedAuthDialog,
    closeManagedCreditDialog,
    config,
    handleManagedAccountRegistration,
    handleManagedAuth,
    handleManagedBrowserLogin,
    handleManagedCheckout,
    handleManagedPasswordReset,
    handleRefreshManagedCredits,
    handleResendManagedVerification,
    loadManagedCreditData,
    managedAuthAgeAccepted,
    managedAuthDataImprovementAccepted,
    managedAuthDisplayName,
    managedAuthError,
    managedAuthMarketingAccepted,
    managedAuthMessage,
    managedAuthOpen,
    managedAuthPassword,
    managedAuthPasswordConfirmation,
    managedAuthPasswordVisible,
    managedAuthPlanId,
    managedAuthPrivacyAccepted,
    managedAuthStatus,
    managedAuthTermsAccepted,
    managedAuthView,
    managedBrowserLoginPending,
    managedCreditAccountId,
    managedCreditError,
    managedCreditMessage,
    managedCreditOpen,
    managedCreditStatus,
    managedPinKeypad,
    managedPlanCatalog,
    managedPlanError,
    managedPlanLoading,
    managedPolicyLinks,
    managedRecoveryView,
    managedSecondaryPin,
    managedSecondaryPinMode,
    managedSignupCode,
    managedSignupStep,
    managedVerificationEmail,
    pressManagedPinDigit,
    resendManagedSignupEmail,
    selectedManagedPlan,
    setConfigValue,
    setManagedAuthAgeAccepted,
    setManagedAuthDataImprovementAccepted,
    setManagedAuthDisplayName,
    setManagedAuthError,
    setManagedAuthMarketingAccepted,
    setManagedAuthMessage,
    setManagedAuthPassword,
    setManagedAuthPasswordConfirmation,
    setManagedAuthPasswordVisible,
    setManagedAuthPlanId,
    setManagedAuthPrivacyAccepted,
    setManagedAuthTermsAccepted,
    setManagedAuthView,
    setManagedCreditAccountId,
    setManagedRecoveryView,
    setManagedSecondaryPin,
    setManagedSecondaryPinFirst,
    setManagedSecondaryPinMode,
    setManagedSignupCode,
    setManagedSignupStep,
    setManagedSignupToken,
    submitManagedPin,
  } = account

  return (
    <>
      {managedCreditOpen && (
        <div className="fixed inset-0 z-[151] flex items-center justify-center bg-black/55 p-4" data-managed-credit-dialog="true">
          <section className="max-h-[calc(100vh-32px)] w-[min(520px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t("크레딧 및 구독")}</h2>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("현재 잔액 ")}{formatManagedCredit(managedAuthStatus?.credits?.available_microusd)}</p>
              </div>
              <Button aria-label={t("크레딧 충전 창 닫기")} onClick={closeManagedCreditDialog} size="icon" type="button" variant="ghost"><X size={18} /></Button>
            </div>
            <div className="mt-5 grid gap-4">
              <div className="rounded-xl border border-[var(--brand)]/30 bg-[var(--brand)]/5 p-3">
                <div className="text-sm font-semibold">{t("월간·연간 구독")}</div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("구독 비교와 결제는 안전한 웹 가격 페이지에서 진행됩니다.")}</p>
                <Button className="mt-3 w-full" onClick={() => globalThis.open(`${String(managedAuthStatus?.server_url || config.ails_auth_server_url || "").trim().replace(/\/$/, "")}/pricing`, "_blank", "noopener,noreferrer")} size="sm" type="button" variant="outline">{t("웹에서 구독 상품 보기")}</Button>
              </div>
              <label className="grid gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                {t("충전 상품")}<select
                  className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]"
                  disabled={managedPlanLoading || !managedPlanCatalog?.plans.length}
                  onChange={(event) => setManagedAuthPlanId(event.target.value)}
                  value={managedAuthPlanId}
                >
                  {managedPlanCatalog?.plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>{plan.name} · {formatManagedPlanPrice(plan.price_krw, plan.billing_period)} · ${Number(plan.credit_usd).toFixed(2)}</option>
                  ))}
                </select>
              </label>
              {selectedManagedPlan() && (
                <div className="rounded-lg bg-[var(--muted)] p-3 text-xs leading-5 text-[var(--muted-foreground)]">
                  <div>{selectedManagedPlan()?.description}</div>
                  <div className="font-semibold text-[var(--brand)]">{t("결제 후 크레딧 $")}{Number(selectedManagedPlan()?.credit_usd || 0).toFixed(2)} {t("지급")}</div>
                </div>
              )}
              <div className="rounded-xl border border-[var(--border)] p-3">
                <div className="text-sm font-semibold">{t("일반 결제")}</div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t("토스 결제창에서 결제 수단을 선택합니다.")}</p>
                <Button className="mt-3 w-full" disabled={managedPlanLoading || !selectedManagedPlan() || selectedManagedPlan()?.checkout_available !== true || isBusy("managed-auth-checkout")} onClick={() => void handleManagedCheckout()} size="sm" type="button">
                  {isBusy("managed-auth-checkout") ? t("결제 창 여는 중...") : t("일반 결제로 충전")}
                </Button>
              </div>
              <div className="rounded-xl border border-[var(--border)] p-3">
                <div className="text-sm font-semibold">{t("등록 계좌 빠른 충전")}</div>
                <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{t("최초 1회 계좌 등록 후에는 AILS 2차 비밀번호만 확인하고 바로 충전합니다.")}</p>
                {!managedCreditStatus?.configured ? (
                  <div className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-500">{t("관리자가 토스 등록결제 계약과 서버 설정을 완료한 뒤 사용할 수 있습니다.")}</div>
                ) : !managedCreditStatus.secondary_pin_configured ? (
                  <Button className="mt-3 w-full" onClick={() => beginManagedPin("setup")} size="sm" type="button" variant="outline">{t("2차 비밀번호 설정")}</Button>
                ) : managedCreditStatus.accounts.length === 0 ? (
                  <Button className="mt-3 w-full" disabled={isBusy("managed-credit-account-registration")} onClick={() => void handleManagedAccountRegistration()} size="sm" type="button" variant="outline">
                    {isBusy("managed-credit-account-registration") ? t("계좌 등록 창 여는 중...") : t("빠른 충전 계좌 등록")}
                  </Button>
                ) : (
                  <div className="mt-3 grid gap-3">
                    <label className="grid gap-1 text-xs text-[var(--muted-foreground)]">
                      {t("결제 계좌")}<select className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)]" onChange={(event) => setManagedCreditAccountId(event.target.value)} value={managedCreditAccountId}>
                        {managedCreditStatus.accounts.map((accountEntry) => <option key={accountEntry.id} value={accountEntry.id}>{accountEntry.name} {t("· 끝자리 ")}{accountEntry.last4}</option>)}
                      </select>
                    </label>
                    <Button disabled={!selectedManagedPlan() || !managedCreditAccountId} onClick={() => beginManagedPin("charge")} size="sm" type="button">{t("등록 계좌로 바로 충전")}</Button>
                  </div>
                )}
              </div>
              {managedSecondaryPinMode && (
                <div className="rounded-xl border border-[var(--brand)]/40 bg-[var(--background)] p-4" data-secondary-pin-keypad="true">
                  <div className="text-center text-sm font-semibold">
                    {managedSecondaryPinMode === "setup" ? t("새 2차 비밀번호") : managedSecondaryPinMode === "confirm" ? t("2차 비밀번호 확인") : t("결제 2차 비밀번호")}
                  </div>
                  <div className="my-3 flex justify-center gap-2" aria-label={t("{p0}자리 입력됨", { p0: managedSecondaryPin.length })}>
                    {Array.from({ length: 6 }, (_, index) => <span className={cn("h-3 w-3 rounded-full border border-[var(--muted-foreground)]", index < managedSecondaryPin.length && "bg-[var(--brand)]")} key={index} />)}
                  </div>
                  <div className="mx-auto grid max-w-64 grid-cols-3 gap-2">
                    {managedPinKeypad.map((digit) => <Button aria-label={`${digit}`} key={digit} onClick={() => pressManagedPinDigit(digit)} type="button" variant="outline">{digit}</Button>)}
                    <Button onClick={() => setManagedSecondaryPin("")} type="button" variant="ghost">{t("전체 삭제")}</Button>
                    <Button onClick={() => setManagedSecondaryPin((current) => current.slice(0, -1))} type="button" variant="ghost">{t("지우기")}</Button>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button onClick={() => { setManagedSecondaryPinMode(""); setManagedSecondaryPin(""); setManagedSecondaryPinFirst("") }} size="sm" type="button" variant="ghost">{t("취소")}</Button>
                    <Button disabled={managedSecondaryPin.length !== 6 || isBusy("managed-credit-pin-setup") || isBusy("managed-credit-quick-charge")} onClick={() => void submitManagedPin()} size="sm" type="button">
                      {managedSecondaryPinMode === "charge" ? t("충전") : t("계속")}
                    </Button>
                  </div>
                </div>
              )}
              {(managedCreditError || managedPlanError) && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-400">{managedCreditError || managedPlanError}</div>}
              {managedCreditMessage && <div className="rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-500">{managedCreditMessage}</div>}
              <div className="flex justify-end">
                <Button disabled={managedPlanLoading} onClick={() => void loadManagedCreditData()} size="sm" type="button" variant="outline">{managedPlanLoading ? t("확인 중...") : t("상태 새로고침")}</Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {managedAuthOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/55 p-4" data-managed-account-dialog="true">
          <section className="max-h-[calc(100vh-32px)] w-[min(480px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img alt="AILS" className="h-10 w-10 shrink-0 object-contain" src="/AILS_logo.png" />
                <div>
                  <h2 className="text-base font-semibold">{t("AILS 계정")}</h2>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{managedAuthStatus?.local_development ? t("서버 없이 로컬 개발 계정으로 사용합니다.") : t("로그인하면 관리형 AI와 크레딧을 사용할 수 있습니다.")}</p>
                </div>
              </div>
              <Button aria-label={t("계정 창 닫기")} onClick={closeManagedAuthDialog} size="icon" type="button" variant="ghost"><X size={18} /></Button>
            </div>

            {managedAuthStatus?.local_development ? <LocalDevelopmentAccount account={account} isBusy={isBusy} /> : managedAuthStatus?.authenticated ? (
              <div className="mt-4 grid gap-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{managedAuthStatus.display_name || managedAuthStatus.email}</div>
                    {managedAuthStatus.display_name && <div className="truncate text-xs text-[var(--muted-foreground)]">{managedAuthStatus.email}</div>}
                    <div className="text-xs text-[var(--muted-foreground)]">{managedAuthStatus.email_verified ? t("이메일 인증됨") : t("이메일 인증 필요")}</div>
                  </div>
                  <Badge>{t("크레딧 ")}{formatManagedCredit(managedAuthStatus.credits?.available_microusd)}</Badge>
                </div>
                {managedAuthStatus.settlements?.status === "unavailable" && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("사용량 확인 상태를 불러오지 못했습니다. 예약금이 반환된 것은 아닙니다.")}</p>}
                {managedAuthStatus.settlements?.status === "paused" && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{t("이 채널의 사용량 자동 확인이 보류 중입니다. 예약금은 유지됩니다.")}</p>}
                {managedAuthStatus.settlements?.status === "checking_provider" && Boolean(managedAuthStatus.settlements?.pending_count) && <p role="status" className="rounded-lg bg-[var(--muted)] p-3 text-xs">
                  {t("사용량 자동 확인 중: {p0}건 · 공급자 관측 사용액 {p1}", { p0: managedAuthStatus.settlements?.pending_count ?? 0, p1: formatManagedCredit(managedAuthStatus.settlements?.observed_usage_microusd) })}<br />
                  {t("관측 사용액은 최종 청구액이 아닙니다. 예약금은 공급자 확인 전까지 유지됩니다.")}
                </p>}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-[var(--muted)] p-2">{t("예약 중")}<br /><strong>{formatManagedCredit(managedAuthStatus.credits?.reserved_microusd)}</strong></div>
                  <div className="rounded-lg bg-[var(--muted)] p-2">{t("누적 사용")}<br /><strong>{formatManagedCredit(managedAuthStatus.credits?.spent_microusd)}</strong></div>
                  <div className="rounded-lg bg-[var(--muted)] p-2">{t("미정산")}<br /><strong>{formatManagedCredit(managedAuthStatus.credits?.debt_microusd)}</strong></div>
                  <div className="rounded-lg bg-[var(--muted)] p-2">{t("사용 가능")}<br /><strong>{formatManagedCredit(managedAuthStatus.credits?.available_microusd)}</strong></div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {!managedAuthStatus.email_verified && <Button disabled={isBusy("managed-auth-verification-resend")} onClick={() => void handleResendManagedVerification()} size="sm" type="button" variant="outline">{t("인증 메일 재전송")}</Button>}
                  <Button disabled={isBusy("managed-auth-refresh")} onClick={() => void handleRefreshManagedCredits()} size="sm" type="button" variant="outline">{isBusy("managed-auth-refresh") ? t("확인 중...") : t("잔액 새로고침")}</Button>
                  <Button disabled={isBusy("managed-auth-logout")} onClick={() => void handleManagedAuth("logout")} size="sm" type="button" variant="ghost">{t("로그아웃")}</Button>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid gap-4">
                <div className="grid grid-cols-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-1" role="tablist">
                  <button
                    aria-selected={managedAuthView === "login"}
                    className={cn("rounded-lg px-3 py-2 text-sm font-semibold transition", managedAuthView === "login" && "bg-[var(--panel)] shadow")}
                    onClick={() => { setManagedAuthView("login"); setManagedSignupStep(1); setManagedSignupToken(""); setManagedSignupCode(Array(6).fill("")); setManagedRecoveryView(""); setManagedAuthError(""); setManagedAuthMessage("") }}
                    role="tab"
                    type="button"
                  >{t("로그인")}</button>
                  <button
                    aria-selected={managedAuthView === "register"}
                    className={cn("rounded-lg px-3 py-2 text-sm font-semibold transition", managedAuthView === "register" && "bg-[var(--panel)] shadow")}
                    onClick={() => { setManagedAuthView("register"); setManagedSignupStep(1); setManagedSignupToken(""); setManagedSignupCode(Array(6).fill("")); setManagedRecoveryView(""); setManagedAuthError(""); setManagedAuthMessage("") }}
                    role="tab"
                    type="button"
                  >{t("회원가입")}</button>
                </div>
                {managedVerificationEmail && (
                  <div className="rounded-lg border border-[var(--brand)]/30 bg-[var(--brand)]/5 p-3 text-xs leading-5">
                    <div className="font-semibold">{t("이메일 인증이 필요합니다")}</div>
                    <div className="break-all text-[var(--muted-foreground)]">{managedVerificationEmail}</div>
                    <Button className="mt-2" disabled={isBusy("managed-auth-verification-resend")} onClick={() => void handleResendManagedVerification()} size="sm" type="button" variant="outline">{isBusy("managed-auth-verification-resend") ? t("전송 중...") : t("인증 메일 재전송")}</Button>
                  </div>
                )}
                {!managedRecoveryView && (
                  <div className="grid gap-1">
                    <h3 className="text-xl font-bold">{managedAuthView === "register" ? t("AILS를 시작해 보세요") : t("다시 만나서 반가워요")}</h3>
                    <p className="text-xs leading-5 text-[var(--muted-foreground)]">{managedAuthView === "register" ? t("이메일을 인증한 뒤 계정을 만듭니다.") : t("이메일과 비밀번호로 로그인하세요.")}</p>
                    {managedAuthView === "register" && (
                      <div className="mt-3 grid grid-cols-5 gap-1" aria-label={t("회원가입 진행 단계")}>
                        {[[1, t("약관")], [2, t("이메일")], [3, t("인증")], [4, t("비밀번호")], [5, t("이름")]].map(([step, label]) => {
                          const stepNumber = Number(step) as 1 | 2 | 3 | 4 | 5
                          return <div className={cn("grid justify-items-center gap-1 rounded-lg border px-1 py-2 text-[10px]", managedSignupStep === stepNumber ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--foreground)]" : "border-[var(--border)] text-[var(--muted-foreground)]")} key={stepNumber}><span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold", managedSignupStep === stepNumber ? "bg-[var(--brand)] text-white" : "bg-[var(--muted)]")}>{stepNumber}</span><span>{label}</span></div>
                        })}
                      </div>
                    )}
                  </div>
                )}
                {managedRecoveryView === "password" ? (
                  <div className="grid gap-3 rounded-lg border border-[var(--border)] p-3">
                    <div className="text-sm font-semibold">{t("비밀번호 찾기")}</div>
                    <label className="grid gap-1 text-xs font-medium text-[var(--muted-foreground)]">{t("가입 이메일")}<Input autoComplete="username" onChange={(event) => setConfigValue("ails_auth_email", event.target.value)} placeholder="user@example.com" type="email" value={String(config.ails_auth_email ?? "")} /></label>
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => setManagedRecoveryView("")} size="sm" type="button" variant="ghost">{t("취소")}</Button>
                      <Button disabled={isBusy("managed-auth-password-reset")} onClick={() => void handleManagedPasswordReset()} size="sm" type="button">{isBusy("managed-auth-password-reset") ? t("전송 중...") : t("재설정 메일 보내기")}</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {managedAuthView === "register" && managedSignupStep === 5 && <label className="grid gap-1 text-xs font-medium text-[var(--muted-foreground)]">{t("이름")}<Input autoComplete="name" maxLength={80} onChange={(event) => setManagedAuthDisplayName(event.target.value)} placeholder={t("사용자 이름")} value={managedAuthDisplayName} /></label>}
                    {(managedAuthView === "login" || (managedAuthView === "register" && managedSignupStep === 2)) && <label className="grid gap-1 text-xs font-medium text-[var(--muted-foreground)]">{t("이메일")}<Input autoComplete="username" onChange={(event) => setConfigValue("ails_auth_email", event.target.value)} placeholder="user@example.com" type="email" value={String(config.ails_auth_email ?? "")} /></label>}
                    {managedAuthView === "register" && managedSignupStep === 3 && (
                      <label className="grid gap-2 text-xs font-medium text-[var(--muted-foreground)]">
                        {t("이메일 인증번호")}<div className="grid grid-cols-6 gap-2">
                          {managedSignupCode.map((digit, index) => (
                            <Input
                              aria-label={t("인증번호 {p0}번째 자리", { p0: index + 1 })}
                              autoComplete={index === 0 ? "one-time-code" : "off"}
                              className="px-0 text-center text-lg font-bold"
                              data-signup-code-index={index}
                              inputMode="numeric"
                              key={index}
                              maxLength={index === 0 ? 6 : 1}
                              onChange={(event) => {
                                const digits = event.target.value.replace(/\D/g, "").slice(0, 6)
                                if (!digits) {
                                  setManagedSignupCode(managedSignupCode.map((value, codeIndex) => codeIndex === index ? "" : value))
                                  return
                                }
                                const nextCode = [...managedSignupCode]
                                for (const [offset, nextDigit] of [...digits].entries()) if (index + offset < nextCode.length) nextCode[index + offset] = nextDigit
                                setManagedSignupCode(nextCode)
                                const nextIndex = Math.min(5, index + digits.length)
                                document.querySelector<HTMLInputElement>(`[data-signup-code-index="${nextIndex}"]`)?.focus()
                                if (nextCode.every(Boolean)) void advanceManagedSignup(nextCode.join(""))
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Backspace" && !digit && index > 0) document.querySelector<HTMLInputElement>(`[data-signup-code-index="${index - 1}"]`)?.focus()
                              }}
                              value={digit}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] leading-4">{String(config.ails_auth_email ?? "")}{t("로 보낸 6자리 번호를 입력하세요.")}</span>
                        <button className="justify-self-start text-xs text-[var(--brand)] hover:underline disabled:opacity-50" disabled={isBusy("managed-auth-signup-email") || isBusy("managed-auth-signup-verify")} onClick={() => void resendManagedSignupEmail()} type="button">{isBusy("managed-auth-signup-email") ? t("전송 중...") : t("인증번호 재전송")}</button>
                      </label>
                    )}
                    {(managedAuthView === "login" || (managedAuthView === "register" && managedSignupStep === 4)) && <label className="grid gap-1 text-xs font-medium text-[var(--muted-foreground)]">{t("비밀번호")}<div className="relative"><Input autoComplete={managedAuthView === "register" ? "new-password" : "current-password"} className="pr-10" minLength={12} onChange={(event) => setManagedAuthPassword(event.target.value)} placeholder={t("12자 이상")} type={managedAuthPasswordVisible ? "text" : "password"} value={managedAuthPassword} /><button aria-label={managedAuthPasswordVisible ? t("비밀번호 숨기기") : t("비밀번호 표시")} className="absolute inset-y-0 right-2 text-[var(--muted-foreground)]" onClick={() => setManagedAuthPasswordVisible((current) => !current)} type="button"><Eye size={16} /></button></div></label>}
                    {managedAuthView === "register" && managedSignupStep === 4 && <label className="grid gap-1 text-xs font-medium text-[var(--muted-foreground)]">{t("비밀번호 확인")}<div className="relative"><Input autoComplete="new-password" className="pr-10" minLength={12} onChange={(event) => setManagedAuthPasswordConfirmation(event.target.value)} placeholder={t("비밀번호 다시 입력")} type={managedAuthPasswordVisible ? "text" : "password"} value={managedAuthPasswordConfirmation} /><button aria-label={managedAuthPasswordVisible ? t("비밀번호 숨기기") : t("비밀번호 표시")} className="absolute inset-y-0 right-2 text-[var(--muted-foreground)]" onClick={() => setManagedAuthPasswordVisible((current) => !current)} type="button"><Eye size={16} /></button></div></label>}
                    {managedAuthView === "register" && managedSignupStep === 1 && (
                      <div className="grid gap-3 rounded-xl border border-[var(--border)] p-4">
                        <label className="flex items-start gap-2 border-b border-[var(--border)] pb-3 text-sm font-semibold"><input checked={managedAuthAgeAccepted && managedAuthTermsAccepted && managedAuthPrivacyAccepted && managedAuthMarketingAccepted && managedAuthDataImprovementAccepted} className="mt-0.5" onChange={(event) => { const checked = event.target.checked; setManagedAuthAgeAccepted(checked); setManagedAuthTermsAccepted(checked); setManagedAuthPrivacyAccepted(checked); setManagedAuthMarketingAccepted(checked); setManagedAuthDataImprovementAccepted(checked) }} type="checkbox" />{t("모두 동의합니다")}</label>
                        <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]"><input checked={managedAuthAgeAccepted} className="mt-0.5" onChange={(event) => setManagedAuthAgeAccepted(event.target.checked)} type="checkbox" /><span>{t("[필수] 만 14세 이상입니다.")}</span></label>
                        <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]"><input checked={managedAuthTermsAccepted} className="mt-0.5" onChange={(event) => setManagedAuthTermsAccepted(event.target.checked)} type="checkbox" /><span>{t("[필수] ")}<button className="text-[var(--brand)] hover:underline" disabled={!managedPolicyLinks.terms} onClick={() => void getAppDesktopApi()?.open_external_url?.(managedPolicyLinks.terms)} type="button">{t("이용약관")}</button>{t("에 동의합니다.")}</span></label>
                        <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]"><input checked={managedAuthPrivacyAccepted} className="mt-0.5" onChange={(event) => setManagedAuthPrivacyAccepted(event.target.checked)} type="checkbox" /><span>{t("[필수] ")}<button className="text-[var(--brand)] hover:underline" disabled={!managedPolicyLinks.privacy} onClick={() => void getAppDesktopApi()?.open_external_url?.(managedPolicyLinks.privacy)} type="button">{t("개인정보 수집 및 이용")}</button>{t("에 동의합니다.")}</span></label>
                        <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]"><input checked={managedAuthMarketingAccepted} className="mt-0.5" onChange={(event) => setManagedAuthMarketingAccepted(event.target.checked)} type="checkbox" /><span className="grid gap-1">{t("[선택] 이벤트 및 혜택 알림 수신에 동의합니다.")}<details className="text-[10px] font-normal"><summary className="cursor-pointer text-[var(--brand)]">{t("자세히 보기")}</summary><span className="mt-1 block leading-4">{t("처리 항목: 이메일 주소 · 목적: 이벤트, 신규 기능, 할인 혜택 안내 · 보유 기간: 동의 철회 또는 회원 탈퇴 시까지 · 설정에서 언제든 철회할 수 있습니다.")}</span></details></span></label>
                        <label className="flex items-start gap-2 text-xs text-[var(--muted-foreground)]"><input checked={managedAuthDataImprovementAccepted} className="mt-0.5" onChange={(event) => setManagedAuthDataImprovementAccepted(event.target.checked)} type="checkbox" /><span className="grid gap-1">{t("[선택] 서비스 품질 향상에 동의합니다.")}<details className="text-[10px] font-normal"><summary className="cursor-pointer text-[var(--brand)]">{t("자세히 보기")}</summary><span className="mt-1 block leading-4">{t("처리 항목: 기능 이용·오류·성능 정보(문서 본문, 답안, 코드 제외) · 목적: 장애 대응과 기능 개선 · 보유 기간: 수집일로부터 1년 또는 동의 철회 시까지 · 설정에서 언제든 철회할 수 있습니다.")}</span></details></span></label>
                      </div>
                    )}
                    <div className="flex justify-end">
                      {managedAuthView === "register" ? <Button disabled={isBusy("managed-auth-register") || isBusy("managed-auth-signup-email") || isBusy("managed-auth-signup-verify") || managedBrowserLoginPending} onClick={() => managedSignupStep < 5 ? void advanceManagedSignup() : void handleManagedAuth("register")} type="button">{managedSignupStep < 5 ? isBusy("managed-auth-signup-email") ? t("인증번호 전송 중...") : isBusy("managed-auth-signup-verify") ? t("확인 중...") : t("계속") : isBusy("managed-auth-register") ? t("가입 중...") : t("회원가입")}</Button> : <Button disabled={isBusy("managed-auth-login") || managedBrowserLoginPending} onClick={() => void handleManagedAuth("login")} type="button">{isBusy("managed-auth-login") ? t("로그인 중...") : t("로그인")}</Button>}
                    </div>
                    {managedAuthView === "login" && <div className="flex justify-end gap-3 text-xs"><button className="text-[var(--brand)] hover:underline" onClick={() => { setManagedRecoveryView("password"); setManagedAuthError(""); setManagedAuthMessage("") }} type="button">{t("비밀번호 찾기")}</button></div>}
                    {managedAuthView === "register" && managedSignupStep > 1 && <button className="text-right text-xs text-[var(--brand)] hover:underline" onClick={() => setManagedSignupStep((current) => Math.max(1, current - 1) as 1 | 2 | 3 | 4 | 5)} type="button">{t("이전 단계")}</button>}
                  </>
                )}
                <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)] before:h-px before:flex-1 before:bg-[var(--border)] after:h-px after:flex-1 after:bg-[var(--border)]">{t("또는")}</div>
                <Button disabled={managedBrowserLoginPending || isBusy("managed-auth-login") || isBusy("managed-auth-register")} onClick={() => void handleManagedBrowserLogin()} type="button" variant="outline">{managedBrowserLoginPending ? <Loader2 className="animate-spin" size={15} /> : <span className="font-bold">G</span>}{managedBrowserLoginPending ? t("Google 로그인 확인 중...") : t("Google로 계속하기")}</Button>
                {managedBrowserLoginPending && <Button onClick={() => cancelManagedBrowserLogin()} size="sm" type="button" variant="ghost">{t("Google 로그인 취소")}</Button>}
              </div>
            )}

            {(managedAuthError || managedAuthStatus?.error || managedAuthStatus?.warning) && <div className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-500" role="alert">{managedAuthError || managedAuthStatus?.error || managedAuthStatus?.warning}</div>}
            {managedAuthMessage && <div className="mt-3 rounded-lg bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-500" role="status">{managedAuthMessage}</div>}
            <p className="mt-4 text-[10px] leading-4 text-[var(--muted-foreground)]">{managedAuthStatus?.local_development ? t("로컬 로그인에서는 비밀번호를 저장하거나 검증하지 않습니다.") : t("로그인 토큰은 Windows Credential Manager에 저장되고, 검수 키는 작업 메모리에만 보관한 뒤 즉시 폐기됩니다.")}</p>
          </section>
        </div>
      )}
    </>
  )
}
