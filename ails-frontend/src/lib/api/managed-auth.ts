import { requestJson } from "./core.ts"

export interface ManagedAuthStatus {
  mode: 'personal' | 'managed'
  configured: boolean
  authenticated: boolean
  local_development?: boolean
  email: string
  display_name?: string
  requested_plan_id?: string
  email_verified?: boolean
  verification_required?: boolean
  device_id: string
  server_url: string
  settlements?: { status: 'checking_provider' | 'paused' | 'unavailable'; pending_count?: number; held_microusd?: number; observed_usage_microusd?: number } | null
  credits?: {
    available_microusd: number
    reserved_microusd: number
    spent_microusd: number
    debt_microusd: number
  } | null
  error?: string
  warning?: string
  login_pending?: boolean
  cancelled?: boolean
}

export interface ManagedPlan {
  id: string
  name: string
  description: string
  price_krw: number
  credit_usd: number
  product_type: 'credit' | 'subscription'
  billing_period: 'monthly' | 'yearly' | null
  enabled: boolean
  sort_order: number
  checkout_available?: boolean
}

export interface ManagedPlanCatalog {
  revision: number
  billing_configured: boolean
  plans: ManagedPlan[]
}

export interface ManagedCreditPaymentStatus {
  configured: boolean
  secondary_pin_configured: boolean
  secondary_pin_locked_until?: string | null
  ready: boolean
  accounts: Array<{
    id: string
    name: string
    bank_code: string
    last4: string
  }>
}

export interface ManagedBrowserAuthStart {
  status: 'pending'
  generation: string
  login_url: string
  expires_at: number | string
}

export function getManagedAuthStatus(signal?: AbortSignal) {
  return requestJson<ManagedAuthStatus>("/auth/status", { signal })
}

export function getManagedPlans() {
  return requestJson<ManagedPlanCatalog>("/auth/plans")
}

export function getManagedCreditPaymentStatus() {
  return requestJson<ManagedCreditPaymentStatus>("/auth/credit-payment")
}

export function setManagedSecondaryPin(payload: { pin: string; pin_confirmation: string }) {
  return requestJson<ManagedCreditPaymentStatus>("/auth/secondary-pin", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function startManagedAccountRegistration() {
  return requestJson<{ registration_url: string }>("/auth/account-registration", {
    method: "POST",
    body: "{}",
  })
}

export function chargeManagedRegisteredAccount(payload: { plan_id: string; account_id: string; secondary_pin: string }) {
  return requestJson<{ status: 'completed'; credits: NonNullable<ManagedAuthStatus['credits']> }>("/auth/registered-account-charge", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function registerManagedAuth(payload: {
  server_url: string
  email: string
  password: string
  password_confirmation: string
  display_name: string
  signup_token: string
  age_accepted: boolean
  terms_accepted: boolean
  privacy_accepted: boolean
  marketing_accepted: boolean
  data_improvement_accepted: boolean
}) {
  return requestJson<ManagedAuthStatus>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function startManagedSignupEmail(payload: { server_url: string; email: string }) {
  return requestJson<{ signup_token: string; expires_at: string }>("/auth/signup/email", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function verifyManagedSignupEmail(payload: { server_url: string; email: string; signup_token: string; code: string }) {
  return requestJson<{ status: 'verified'; email: string }>("/auth/signup/email/verify", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function loginManagedAuth(payload: { server_url: string; email: string; password: string }) {
  return requestJson<ManagedAuthStatus>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function resendManagedEmailVerification(payload: { server_url: string; email: string }) {
  return requestJson<{ status: string }>("/auth/email/verification/resend", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function requestManagedPasswordReset(payload: { server_url: string; email: string }) {
  return requestJson<{ status: string }>("/auth/password/reset/request", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function selectManagedPlan(payload: { plan_id: string }) {
  return requestJson<ManagedAuthStatus>("/auth/plan", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function logoutManagedAuth() {
  return requestJson<ManagedAuthStatus>("/auth/logout", { method: "POST" })
}

export function createManagedCheckout(payload: { plan_id: string }) {
  return requestJson<{ checkout_url: string }>("/auth/checkout", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function startManagedBrowserAuth(payload: { server_url: string; generation: string }, signal?: AbortSignal) {
  return requestJson<ManagedBrowserAuthStart>("/auth/browser/start", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  })
}

export function pollManagedBrowserAuth(signal?: AbortSignal) {
  return requestJson<ManagedAuthStatus>("/auth/browser/poll", {
    method: "POST",
    body: "{}",
    signal,
  })
}

export function cancelManagedBrowserAuth(payload: { generation?: string }) {
  return requestJson<ManagedAuthStatus>("/auth/browser/cancel", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function submitFeedback(payload: {
  category: 'bug' | 'feature' | 'usability' | 'ai_output' | 'other'
  title: string
  body: string
}) {
  return requestJson<{ status: 'sent' }>("/feedback", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}
