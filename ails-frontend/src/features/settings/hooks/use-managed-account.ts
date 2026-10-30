import { PERSONAL_MODE } from "../../../edition.ts"
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"

import { t } from "../../../lib/i18n.ts"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"
import { waitForInitialDocument } from "../../../lib/initial-document-readiness.ts"
import {
  AILSApiError,
  cancelManagedBrowserAuth,
  chargeManagedRegisteredAccount,
  createManagedCheckout,
  getAIComplianceStatus,
  getManagedAuthStatus,
  getManagedCreditPaymentStatus,
  getManagedPlans,
  loginManagedAuth,
  logoutManagedAuth,
  pollManagedBrowserAuth,
  registerManagedAuth,
  requestManagedPasswordReset,
  resendManagedEmailVerification,
  setManagedSecondaryPin as saveManagedSecondaryPin,
  startManagedAccountRegistration,
  startManagedBrowserAuth,
  startManagedSignupEmail,
  verifyManagedSignupEmail,
  type AILSConfig,
  type ManagedAuthStatus,
  type ManagedCreditPaymentStatus,
  type ManagedPlanCatalog,
} from "../../../lib/api"

type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
  onError?: (error: unknown) => void,
) => Promise<void>

type UseManagedAccountOptions = {
  config: AILSConfig
  onLoginCancelled?: () => void
  onLoginSuccess?: (status: ManagedAuthStatus) => Promise<string | void>
  runInteraction: RunInteraction
  setConfig: Dispatch<SetStateAction<AILSConfig>>
  setNotice: Dispatch<SetStateAction<string>>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown) {
  const name = typeof error === "object" && error
    ? String((error as { name?: unknown }).name ?? "")
    : ""
  return name === "AbortError"
}

function randomizedPinKeypad() {
  const digits = Array.from({ length: 10 }, (_, index) => index)
  const random = new Uint32Array(10)
  crypto.getRandomValues(random)
  for (let index = digits.length - 1; index > 0; index -= 1) {
    const swapIndex = random[index] % (index + 1)
    ;[digits[index], digits[swapIndex]] = [digits[swapIndex], digits[index]]
  }
  return digits
}

function waitForManagedAuthPoll(signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new DOMException("Login cancelled", "AbortError"))
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 1500)
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer)
      reject(new DOMException("Login cancelled", "AbortError"))
    }, { once: true })
  })
}

export function formatManagedCredit(value: number | undefined) {
  return `$${(Math.max(0, Number(value) || 0) / 1_000_000).toFixed(4)}`
}

export function formatManagedPlanPrice(value: number, period: string | null) {
  const suffix = period === "monthly" ? t("/월") : period === "yearly" ? t("/년") : ""
  return t("{p0}원{p1}", { p0: Math.max(0, Math.trunc(Number(value) || 0)).toLocaleString("ko-KR"), p1: suffix })
}

export function useManagedAccount({ config, onLoginCancelled, onLoginSuccess, runInteraction, setConfig, setNotice }: UseManagedAccountOptions) {
  const [managedAuthStatus, setManagedAuthStatus] = useState<ManagedAuthStatus | null>(null)
  const [localDevelopmentName, setLocalDevelopmentName] = useState("")
  const [managedAuthError, setManagedAuthError] = useState("")
  const [managedAuthOpen, setManagedAuthOpen] = useState(false)
  const [managedCreditOpen, setManagedCreditOpen] = useState(false)
  const [managedCreditStatus, setManagedCreditStatus] = useState<ManagedCreditPaymentStatus | null>(null)
  const [managedCreditError, setManagedCreditError] = useState("")
  const [managedCreditMessage, setManagedCreditMessage] = useState("")
  const [managedCreditAccountId, setManagedCreditAccountId] = useState("")
  const [managedSecondaryPinMode, setManagedSecondaryPinMode] = useState<"" | "setup" | "confirm" | "charge">("")
  const [managedSecondaryPin, setManagedSecondaryPin] = useState("")
  const [managedSecondaryPinFirst, setManagedSecondaryPinFirst] = useState("")
  const [managedPinKeypad, setManagedPinKeypad] = useState<number[]>(randomizedPinKeypad)
  const [managedAuthView, setManagedAuthView] = useState<"login" | "register">("login")
  const [managedSignupStep, setManagedSignupStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [managedSignupToken, setManagedSignupToken] = useState("")
  const [managedSignupCode, setManagedSignupCode] = useState<string[]>(() => Array(6).fill(""))
  const managedSignupVerifyInFlightRef = useRef(false)
  const [managedAuthPassword, setManagedAuthPassword] = useState("")
  const [managedAuthPasswordConfirmation, setManagedAuthPasswordConfirmation] = useState("")
  const [managedAuthPasswordVisible, setManagedAuthPasswordVisible] = useState(false)
  const [managedAuthDisplayName, setManagedAuthDisplayName] = useState("")
  const [managedAuthPlanId, setManagedAuthPlanId] = useState("")
  const [managedVerificationEmail, setManagedVerificationEmail] = useState("")
  const [managedRecoveryView, setManagedRecoveryView] = useState<"" | "password">("")
  const [managedAuthMessage, setManagedAuthMessage] = useState("")
  const [managedAuthTermsAccepted, setManagedAuthTermsAccepted] = useState(false)
  const [managedAuthPrivacyAccepted, setManagedAuthPrivacyAccepted] = useState(false)
  const [managedAuthAgeAccepted, setManagedAuthAgeAccepted] = useState(false)
  const [managedAuthMarketingAccepted, setManagedAuthMarketingAccepted] = useState(false)
  const [managedAuthDataImprovementAccepted, setManagedAuthDataImprovementAccepted] = useState(false)
  const [managedPlanCatalog, setManagedPlanCatalog] = useState<ManagedPlanCatalog | null>(null)
  const [managedPlanLoading, setManagedPlanLoading] = useState(false)
  const [managedPlanError, setManagedPlanError] = useState("")
  const [managedPolicyLinks, setManagedPolicyLinks] = useState({ terms: "", privacy: "" })
  const [managedBrowserLoginPending, setManagedBrowserLoginPending] = useState(false)
  const managedBrowserLoginAbortRef = useRef<AbortController | null>(null)
  const managedBrowserLoginGenerationRef = useRef("")

  useEffect(() => {
    if (PERSONAL_MODE) return
    if (!managedAuthOpen || !managedAuthStatus?.authenticated) return
    let active = true
    let inFlight = false
    const timer = window.setInterval(() => {
      if (inFlight) return
      inFlight = true
      void getManagedAuthStatus().then(status => {
        if (active) setManagedAuthStatus(status)
      }).catch(() => {
        if (active) setManagedAuthStatus(current => current ? { ...current, settlements: { status: "unavailable" } } : current)
      }).finally(() => { inFlight = false })
    }, 30_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [managedAuthOpen, managedAuthStatus?.authenticated, managedAuthStatus?.email])

  function setConfigValue(key: string, value: string | boolean | number) {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  function applyManagedAuthStatus(status: ManagedAuthStatus) {
    setManagedAuthStatus(status)
    if (status.local_development) {
      if (status.authenticated) setLocalDevelopmentName(status.display_name ?? status.email)
      return
    }
    setConfig((current) => ({
      ...current,
      ails_auth_server_url: status.server_url || current.ails_auth_server_url,
      ails_auth_email: status.email,
      ails_device_id: status.device_id,
    }))
  }

  function managedAuthServerUrl() {
    return String(managedAuthStatus?.server_url || config.ails_auth_server_url || "").trim()
  }

  function selectedManagedPlan() {
    return managedPlanCatalog?.plans.find((plan) => plan.id === managedAuthPlanId)
  }

  async function loadManagedPolicies() {
    try {
      const compliance = await getAIComplianceStatus()
      setManagedPolicyLinks({
        terms: compliance.policy.terms_of_use_url,
        privacy: compliance.policy.privacy_policy_url,
      })
    } catch {
      setManagedPolicyLinks({ terms: "", privacy: "" })
    }
  }

  useEffect(() => {
    if (PERSONAL_MODE) return
    const controller = new AbortController()
    // The initial account display is preparation, not a prerequisite for a
    // local document. Explicit account/settings actions below still load now.
    void waitForInitialDocument(controller.signal)
      .then(() => getManagedAuthStatus(controller.signal))
      .then((status) => {
        if (!controller.signal.aborted) {
          setManagedAuthStatus(status)
          if (status.local_development) {
            if (status.authenticated) setLocalDevelopmentName(status.display_name ?? status.email)
            return
          }
          setConfig((current) => ({
            ...current,
            ails_auth_server_url: status.server_url || current.ails_auth_server_url,
            ails_auth_email: status.email,
            ails_device_id: status.device_id,
          }))
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [setConfig])

  function prepareForSettings(normalizedConfig: AILSConfig) {
    if (PERSONAL_MODE) return
    setManagedAuthError("")
    setManagedAuthPassword("")
    void getManagedAuthStatus()
      .then(applyManagedAuthStatus)
      .catch((error) => setManagedAuthStatus({
        mode: normalizedConfig.ai_model_selection?.default.mode === "local" ? "personal" : "managed",
        configured: Boolean(normalizedConfig.ails_auth_server_url),
        authenticated: false,
        email: String(normalizedConfig.ails_auth_email ?? ""),
        device_id: String(normalizedConfig.ails_device_id ?? ""),
        server_url: String(normalizedConfig.ails_auth_server_url ?? ""),
        error: errorMessage(error),
      }))
  }

  function openManagedAuthDialog() {
    if (PERSONAL_MODE) return
    setManagedAuthError("")
    setManagedAuthMessage("")
    setManagedAuthView("login")
    setManagedSignupStep(1)
    setManagedSignupToken("")
    setManagedSignupCode(Array(6).fill(""))
    setManagedAuthAgeAccepted(false)
    setManagedAuthTermsAccepted(false)
    setManagedAuthPrivacyAccepted(false)
    setManagedAuthMarketingAccepted(false)
    setManagedAuthDataImprovementAccepted(false)
    setManagedRecoveryView("")
    setManagedAuthPassword("")
    setManagedAuthPasswordConfirmation("")
    setManagedAuthPasswordVisible(false)
    setManagedAuthOpen(true)
    void getManagedAuthStatus().then(applyManagedAuthStatus).catch((error) => setManagedAuthError(errorMessage(error)))
    void loadManagedPolicies()
  }

  function cancelManagedBrowserLogin(showMessage = true) {
    const hadPendingRequest = Boolean(managedBrowserLoginAbortRef.current || managedBrowserLoginPending)
    const generation = managedBrowserLoginGenerationRef.current
    managedBrowserLoginGenerationRef.current = ""
    managedBrowserLoginAbortRef.current?.abort()
    managedBrowserLoginAbortRef.current = null
    setManagedBrowserLoginPending(false)
    if (showMessage) onLoginCancelled?.()
    if (showMessage) setManagedAuthError(t("Google 로그인을 취소했습니다."))
    if (!generation && !hadPendingRequest) return
    void cancelManagedBrowserAuth({ generation })
      .then(applyManagedAuthStatus)
      .catch((error) => {
        if (showMessage) setManagedAuthError(errorMessage(error))
      })
  }

  function closeManagedAuthDialog() {
    cancelManagedBrowserLogin(false)
    onLoginCancelled?.()
    setManagedAuthPassword("")
    setManagedAuthPasswordConfirmation("")
    setManagedSignupToken("")
    setManagedSignupCode(Array(6).fill(""))
    setManagedAuthPasswordVisible(false)
    setManagedAuthOpen(false)
  }

  async function advanceManagedSignup(codeOverride = "") {
    const serverUrl = managedAuthServerUrl()
    const email = String(config.ails_auth_email ?? "").trim()
    if (managedSignupStep === 1) {
      if (!managedAuthAgeAccepted || !managedAuthTermsAccepted || !managedAuthPrivacyAccepted) {
        setManagedAuthError(t("만 14세 이상 확인과 필수 약관에 동의해 주세요."))
        return
      }
      setManagedAuthError("")
      setManagedSignupStep(2)
      return
    }
    if (managedSignupStep === 2) {
      if (!serverUrl || !email) {
        setManagedAuthError(!serverUrl ? t("인증 서버 URL을 입력해 주세요.") : t("이메일을 입력해 주세요."))
        return
      }
      setManagedAuthError("")
      await runInteraction("managed-auth-signup-email", t("회원가입 이메일 인증"), async () => {
        const result = await startManagedSignupEmail({ server_url: serverUrl, email })
        setManagedSignupToken(result.signup_token)
        setManagedSignupCode(Array(6).fill(""))
        setManagedSignupStep(3)
        return t("인증번호를 보냈습니다.")
      })
      return
    }
    if (managedSignupStep === 3) {
      const code = codeOverride || managedSignupCode.join("")
      if (!/^\d{6}$/.test(code) || managedSignupVerifyInFlightRef.current) {
        setManagedAuthError(t("6자리 이메일 인증번호를 입력해 주세요."))
        return
      }
      setManagedAuthError("")
      managedSignupVerifyInFlightRef.current = true
      try {
        await runInteraction("managed-auth-signup-verify", t("회원가입 이메일 인증"), async () => {
          try {
            await verifyManagedSignupEmail({ server_url: serverUrl, email, signup_token: managedSignupToken, code })
            setManagedSignupStep(4)
            return t("이메일 인증을 완료했습니다.")
          } catch (error) {
            setManagedAuthError(errorMessage(error))
            throw error
          }
        })
      } finally {
        managedSignupVerifyInFlightRef.current = false
      }
      return
    }
    if (managedSignupStep === 4) {
      const validationError = managedAuthPassword.length < 12
        ? t("비밀번호를 12자 이상 입력해 주세요.")
        : managedAuthPassword !== managedAuthPasswordConfirmation
          ? t("비밀번호 확인이 일치하지 않습니다.")
          : ""
      if (validationError) {
        setManagedAuthError(validationError)
        return
      }
      setManagedAuthError("")
      setManagedSignupStep(5)
    }
  }

  async function resendManagedSignupEmail() {
    const serverUrl = managedAuthServerUrl()
    const email = String(config.ails_auth_email ?? "").trim()
    if (!serverUrl || !email) {
      setManagedAuthError(!serverUrl ? t("인증 서버 URL을 입력해 주세요.") : t("이메일을 입력해 주세요."))
      return
    }
    setManagedAuthError("")
    await runInteraction("managed-auth-signup-email", t("인증번호 재전송"), async () => {
      try {
        const result = await startManagedSignupEmail({ server_url: serverUrl, email })
        setManagedSignupToken(result.signup_token)
        setManagedSignupCode(Array(6).fill(""))
        return t("새 인증번호를 보냈습니다.")
      } catch (error) {
        setManagedAuthError(errorMessage(error))
        throw error
      }
    })
  }

  async function handleManagedAuth(action: "register" | "login" | "logout") {
    const serverUrl = managedAuthServerUrl()
    const email = managedAuthStatus?.local_development ? localDevelopmentName : String(config.ails_auth_email ?? "").trim()
    if (action !== "logout" && !(action === "login" && managedAuthStatus?.local_development)) {
      const validationError = !serverUrl
        ? t("인증 서버 URL을 입력해 주세요.")
        : !email
          ? t("이메일을 입력해 주세요.")
          : managedAuthPassword.length < 12
            ? t("비밀번호를 12자 이상 입력해 주세요.")
            : action === "register" && !managedAuthDisplayName.trim()
              ? t("이름을 입력해 주세요.")
              : action === "register" && !managedSignupToken
                ? t("이메일 인증을 먼저 완료해 주세요.")
                : action === "register" && managedAuthPassword !== managedAuthPasswordConfirmation
                  ? t("비밀번호 확인이 일치하지 않습니다.")
                  : action === "register" && (!managedAuthAgeAccepted || !managedAuthTermsAccepted || !managedAuthPrivacyAccepted)
                    ? t("만 14세 이상 확인과 필수 약관에 동의해 주세요.")
                    : ""
      if (validationError) {
        setManagedAuthError(validationError)
        return
      }
    }
    setManagedAuthError("")
    await runInteraction(`managed-auth-${action}`, t("AILS 계정"), async () => {
      let status: ManagedAuthStatus
      try {
        if (action === "logout") {
          status = await logoutManagedAuth()
        } else if (action === "register") {
          status = await registerManagedAuth({
            server_url: serverUrl,
            email,
            password: managedAuthPassword,
            password_confirmation: managedAuthPasswordConfirmation,
            display_name: managedAuthDisplayName.trim(),
            signup_token: managedSignupToken,
            age_accepted: managedAuthAgeAccepted,
            terms_accepted: managedAuthTermsAccepted,
            privacy_accepted: managedAuthPrivacyAccepted,
            marketing_accepted: managedAuthMarketingAccepted,
            data_improvement_accepted: managedAuthDataImprovementAccepted,
          })
        } else {
          status = await loginManagedAuth({ server_url: serverUrl, email, password: managedAuthPassword })
        }
      } catch (error) {
        if (error instanceof AILSApiError && error.code === "email_verification_required") setManagedVerificationEmail(email)
        setManagedAuthError(errorMessage(error))
        throw error
      }
      applyManagedAuthStatus(status)
      setManagedAuthPassword("")
      setManagedAuthPasswordConfirmation("")
      if (status.warning) return t("로그아웃했습니다. 서버 경고: {p0}", { p0: status.warning })
      if (action === "logout") return t("AILS 계정에서 로그아웃했습니다.")
      if (action === "register") {
        setManagedVerificationEmail("")
        setManagedSignupToken("")
        setManagedSignupCode(Array(6).fill(""))
        setManagedAuthMessage(t("가입이 완료되었습니다."))
        return t("AILS 가입과 로그인을 완료했습니다.")
      }
      setManagedVerificationEmail("")
      return await onLoginSuccess?.(status) || t("AILS 계정에 로그인했습니다.")
    })
  }

  async function handleResendManagedVerification() {
    const email = managedVerificationEmail || String(config.ails_auth_email ?? "").trim()
    if (!email) {
      setManagedAuthError(t("이메일을 입력해 주세요."))
      return
    }
    setManagedAuthError("")
    await runInteraction("managed-auth-verification-resend", t("인증 메일 재전송"), async () => {
      await resendManagedEmailVerification({ server_url: managedAuthServerUrl(), email })
      setManagedVerificationEmail(email)
      setManagedAuthMessage(t("인증 메일을 다시 보냈습니다. 받은 편지함을 확인해 주세요."))
      return t("인증 메일을 다시 보냈습니다.")
    })
  }

  async function handleManagedPasswordReset() {
    const email = String(config.ails_auth_email ?? "").trim()
    if (!email) {
      setManagedAuthError(t("이메일을 입력해 주세요."))
      return
    }
    setManagedAuthError("")
    await runInteraction("managed-auth-password-reset", t("비밀번호 재설정"), async () => {
      await requestManagedPasswordReset({ server_url: managedAuthServerUrl(), email })
      setManagedAuthMessage(t("가입된 이메일이면 비밀번호 재설정 메일을 보냈습니다."))
      return t("비밀번호 재설정 요청을 접수했습니다.")
    })
  }

  async function loadManagedCreditData() {
    setManagedPlanLoading(true)
    setManagedPlanError("")
    setManagedCreditError("")
    try {
      const [catalog, payment] = await Promise.all([getManagedPlans(), getManagedCreditPaymentStatus()])
      const products = catalog.plans.filter((plan) => plan.product_type === "credit" && plan.price_krw > 0)
      setManagedPlanCatalog({ ...catalog, plans: products })
      setManagedAuthPlanId((current) => products.some((plan) => plan.id === current) ? current : (products[0]?.id || ""))
      setManagedCreditStatus(payment)
      setManagedCreditAccountId((current) => payment.accounts.some((account) => account.id === current) ? current : (payment.accounts[0]?.id || ""))
    } catch (error) {
      setManagedCreditError(errorMessage(error))
    } finally {
      setManagedPlanLoading(false)
    }
  }

  async function openManagedCreditDialog() {
    if (PERSONAL_MODE) return
    setManagedCreditError("")
    setManagedCreditMessage("")
    const status = await getManagedAuthStatus().catch(() => managedAuthStatus)
    if (!status?.authenticated) {
      openManagedAuthDialog()
      return
    }
    applyManagedAuthStatus(status)
    setManagedCreditOpen(true)
    void loadManagedCreditData()
  }

  function closeManagedCreditDialog() {
    setManagedCreditOpen(false)
    setManagedSecondaryPinMode("")
    setManagedSecondaryPin("")
    setManagedSecondaryPinFirst("")
  }

  function beginManagedPin(mode: "setup" | "charge") {
    setManagedSecondaryPinMode(mode)
    setManagedSecondaryPin("")
    setManagedSecondaryPinFirst("")
    setManagedPinKeypad(randomizedPinKeypad())
    setManagedCreditError("")
  }

  function pressManagedPinDigit(digit: number) {
    setManagedSecondaryPin((current) => current.length < 6 ? `${current}${digit}` : current)
  }

  async function submitManagedPin() {
    if (managedSecondaryPin.length !== 6) {
      setManagedCreditError(t("숫자 6자리를 입력해 주세요."))
      return
    }
    if (managedSecondaryPinMode === "setup") {
      setManagedSecondaryPinFirst(managedSecondaryPin)
      setManagedSecondaryPin("")
      setManagedSecondaryPinMode("confirm")
      setManagedPinKeypad(randomizedPinKeypad())
      return
    }
    if (managedSecondaryPinMode === "confirm") {
      if (managedSecondaryPin !== managedSecondaryPinFirst) {
        beginManagedPin("setup")
        setManagedCreditError(t("2차 비밀번호가 일치하지 않습니다. 처음부터 다시 입력해 주세요."))
        return
      }
      await runInteraction("managed-credit-pin-setup", t("결제 2차 비밀번호 설정"), async () => {
        const payment = await saveManagedSecondaryPin({ pin: managedSecondaryPin, pin_confirmation: managedSecondaryPinFirst })
        setManagedCreditStatus(payment)
        setManagedSecondaryPinMode("")
        setManagedSecondaryPin("")
        setManagedSecondaryPinFirst("")
        setManagedCreditMessage(t("결제 2차 비밀번호를 설정했습니다."))
        return t("결제 2차 비밀번호를 설정했습니다.")
      }).catch((error) => setManagedCreditError(errorMessage(error)))
      return
    }
    if (managedSecondaryPinMode !== "charge") return
    const product = selectedManagedPlan()
    if (!product || !managedCreditAccountId) {
      setManagedCreditError(!product ? t("충전할 상품을 선택해 주세요.") : t("등록 계좌를 선택해 주세요."))
      return
    }
    await runInteraction("managed-credit-quick-charge", t("등록 계좌 빠른 충전"), async () => {
      const result = await chargeManagedRegisteredAccount({
        plan_id: product.id,
        account_id: managedCreditAccountId,
        secondary_pin: managedSecondaryPin,
      })
      setManagedAuthStatus((current) => current ? { ...current, credits: result.credits } : current)
      setManagedSecondaryPinMode("")
      setManagedSecondaryPin("")
      setManagedCreditMessage(t("{p0} 충전을 완료했습니다.", { p0: product.name }))
      await loadManagedCreditData()
      return t("{p0} 충전을 완료했습니다.", { p0: product.name })
    }).catch((error) => {
      setManagedSecondaryPin("")
      setManagedPinKeypad(randomizedPinKeypad())
      setManagedCreditError(errorMessage(error))
    })
  }

  async function handleManagedAccountRegistration() {
    setManagedCreditError("")
    await runInteraction("managed-credit-account-registration", t("빠른 충전 계좌 등록"), async () => {
      const result = await startManagedAccountRegistration()
      const bridge = getAppDesktopApi()
      if (!bridge?.open_external_url) throw new Error(t("계좌 등록 창을 열 수 없습니다."))
      const opened = await bridge.open_external_url(result.registration_url)
      if (opened?.opened === false) throw new Error(t("계좌 등록 창을 열지 못했습니다."))
      setManagedCreditMessage(t("계좌 등록을 마친 뒤 상태 새로고침을 눌러 주세요."))
      return t("계좌 등록 창을 열었습니다.")
    }).catch((error) => setManagedCreditError(errorMessage(error)))
  }

  async function handleManagedCheckout() {
    const plan = selectedManagedPlan()
    if (!plan || plan.checkout_available !== true || !managedPlanCatalog?.billing_configured) {
      setManagedCreditError(!plan ? t("충전할 크레딧 상품을 선택해 주세요.") : t("결제 기능을 준비 중입니다."))
      return
    }
    setManagedCreditError("")
    await runInteraction("managed-auth-checkout", t("크레딧 충전"), async () => {
      try {
        const result = await createManagedCheckout({ plan_id: plan.id })
        const bridge = getAppDesktopApi()
        if (!bridge?.open_external_url) throw new Error(t("결제 창을 열 수 없습니다."))
        const opened = await bridge.open_external_url(result.checkout_url)
        if (opened?.opened === false) throw new Error(t("결제 창을 열지 못했습니다."))
        return t("결제 창을 열었습니다.")
      } catch (error) {
        setManagedCreditError(errorMessage(error))
        throw error
      }
    })
  }

  async function handleRefreshManagedCredits() {
    setManagedAuthError("")
    await runInteraction("managed-auth-refresh", t("크레딧 잔액 확인"), async () => {
      try {
        const status = await getManagedAuthStatus()
        applyManagedAuthStatus(status)
        if (status.error) throw new Error(status.error)
        return t("관리형 AI 크레딧 잔액을 갱신했습니다.")
      } catch (error) {
        setManagedAuthError(errorMessage(error))
        throw error
      }
    })
  }

  async function handleManagedBrowserLogin() {
    const serverUrl = managedAuthServerUrl()
    if (!serverUrl) {
      setManagedAuthError(t("AILS 인증 서버가 설정되지 않았습니다."))
      return
    }
    if (managedBrowserLoginPending) return

    const controller = new AbortController()
    const generation = globalThis.crypto.randomUUID()
    managedBrowserLoginAbortRef.current?.abort()
    managedBrowserLoginAbortRef.current = controller
    managedBrowserLoginGenerationRef.current = generation
    setManagedAuthError("")
    setManagedBrowserLoginPending(true)
    try {
      const started = await startManagedBrowserAuth({ server_url: serverUrl, generation }, controller.signal)
      const numericExpiry = Number(started.expires_at)
      const expiresAt = Number.isFinite(numericExpiry)
        ? numericExpiry * (numericExpiry < 1_000_000_000_000 ? 1000 : 1)
        : Date.parse(String(started.expires_at))
      if (started.status !== "pending" || started.generation !== generation || !started.login_url || !Number.isFinite(expiresAt)) {
        throw new Error(t("Google 로그인 시작 응답이 올바르지 않습니다."))
      }
      const bridge = getAppDesktopApi()
      const openAuthLoginUrl = bridge?.open_auth_login_url
      const openExternalUrl = bridge?.open_external_url
      if (!openAuthLoginUrl && !openExternalUrl) throw new Error(t("외부 로그인 창을 열 수 없습니다."))
      const opened = await (openAuthLoginUrl
        ? openAuthLoginUrl(started.login_url)
        : openExternalUrl!(started.login_url))
      if (opened?.opened === false) throw new Error(t("Google 로그인 창을 열지 못했습니다."))

      while (Date.now() < expiresAt) {
        await waitForManagedAuthPoll(controller.signal)
        const status = await pollManagedBrowserAuth(controller.signal)
        if (status.login_pending) continue
        if (!status.authenticated) throw new Error(status.error || t("Google 로그인이 취소되었거나 완료되지 않았습니다."))
        managedBrowserLoginGenerationRef.current = ""
        applyManagedAuthStatus(status)
        setManagedAuthOpen(false)
        setNotice(await onLoginSuccess?.(status) || t("Google 계정으로 로그인했습니다."))
        return
      }
      throw new Error(t("Google 로그인 시간이 만료되었습니다. 다시 시도해 주세요."))
    } catch (error) {
      if (!isAbortError(error)) setManagedAuthError(errorMessage(error))
    } finally {
      const unfinishedGeneration = managedBrowserLoginGenerationRef.current
      if (unfinishedGeneration && managedBrowserLoginAbortRef.current === controller) {
        managedBrowserLoginGenerationRef.current = ""
        void cancelManagedBrowserAuth({ generation: unfinishedGeneration })
          .then(applyManagedAuthStatus)
          .catch(() => undefined)
      }
      if (managedBrowserLoginAbortRef.current === controller) {
        managedBrowserLoginAbortRef.current = null
        setManagedBrowserLoginPending(false)
      }
    }
  }

  return {
    localDevelopmentName,
    setLocalDevelopmentName,
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
    openManagedAuthDialog,
    openManagedCreditDialog,
    prepareForSettings,
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
  }
}

export type ManagedAccountController = ReturnType<typeof useManagedAccount>
