import { requestJson } from "./core.ts"

export type AIConsentDecision = "unset" | "granted" | "declined" | "withdrawn"

export interface AIComplianceStatus {
  policy: {
    policy_version: string
    consent_version: number
    privacy_policy_url: string
    terms_of_use_url: string
    ai_disclosure_url: string
    data_deletion_url: string
    support_email: string
    configured: boolean
  }
  consent: {
    status: AIConsentDecision
    valid: boolean
    version: number
    required_version: number
    policy_version: string
    required_policy_version: string
    recorded_at: string
    withdrawn_at: string
  }
  external_providers: Array<{
    id: string
    name: string
    data: string[]
    privacy_url: string
  }>
  data_categories: string[]
  local_data_directory: string
}

export function getAIComplianceStatus() {
  return requestJson<AIComplianceStatus>("/compliance")
}

export function setAIConsent(
  action: "grant" | "decline" | "withdraw",
  acknowledgements?: {
    privacy_and_terms: boolean
    external_ai_processing: boolean
    cross_border_transfer: boolean
  },
) {
  return requestJson<AIComplianceStatus>("/compliance/consent", {
    method: "POST",
    body: JSON.stringify({ action, acknowledgements }),
  })
}

export function openAIDataDirectory() {
  return requestJson<{ opened: boolean; path?: string }>("/compliance/open-data-directory", {
    method: "POST",
    body: JSON.stringify({}),
  })
}
