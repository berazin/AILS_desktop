import { requestJson } from "./core.ts"

export interface LanguageProfileCommand {
  executable: string
  arguments: string[]
  prepare?: LanguageProfileCommand[]
  by_extension?: Record<string, LanguageProfileCommand>
}

export interface LanguageProfile {
  id: string
  label: string
  extensions: string[]
  executable: string
  arguments: string[]
  commands?: Partial<Record<"run" | "build" | "test", LanguageProfileCommand>>
  version_arguments: string[]
  template: string
  command_state?: "ready" | "needs_review"
  runtime?: { manager: "system" | "mise"; tool: string; version: string }
  syntax?: { pack_id: string; grammar?: string; configuration?: string; scope_name?: string }
  language_server?: {
    manager: string
    package: string
    version?: string
    executable_path?: string
    installed?: boolean
  }
  verification?: {
    checked: boolean
    runtime_path?: string
    executables: Record<string, string> | string[]
  }
  source?: {
    registry?: string
    extension_id?: string
    version?: string
    verified_publisher?: boolean
    execution_recipe?: {
      registry: string
      extension_id?: string
      version?: string
      sha256?: string
      executables?: string[]
    }
  }
  installed?: boolean
  executable_path?: string
  actions?: string[]
}

export interface LanguageProfilesPayload {
  path: string
  packs_path?: string
  placeholders: string[]
  profiles: LanguageProfile[]
}

export interface LanguageRegistryExtension {
  id: string
  namespace: string
  name: string
  version: string
  label: string
  description: string
  verified: boolean
  deprecated: boolean
  downloads: number
  updated_at: string
  icon_url?: string
  source: "openvsx"
}

export interface LanguageRegistryRuntime {
  id: string
  label: string
  description: string
  version: string
  install_supported: boolean
  recommended?: boolean
  source: "mise"
}

export interface LanguageRegistryRecipe {
  available: boolean
  language_id: string
  source: "openvsx-code-runner" | "ails-reviewed" | ""
  version: string
  executables: string[]
}

export interface LanguageRegistryServer {
  id: string
  label: string
  description: string
  languages: string[]
  version: string
  homepage?: string
  licenses?: string[]
  install_supported: boolean
  source: "mason"
}

export interface LanguageRegistrySearchPayload {
  query: string
  extensions: LanguageRegistryExtension[]
  runtimes: LanguageRegistryRuntime[]
  language_servers: LanguageRegistryServer[]
  recipe: LanguageRegistryRecipe
  recommended_runtime_id: string
  errors: Array<{ source: string; error: string }>
  sources: Array<{ id: string; label: string; purpose: string }>
}

export interface LanguagePackInstallJob {
  job_id: string
  status: "queued" | "running" | "completed" | "failed"
  phase: string
  progress_percent: number
  output: string
  error: string
  elapsed_seconds: number
  profile?: LanguageProfile | null
}

export interface LanguageProfileAssets {
  profile_id: string
  scope_name?: string
  grammar: Record<string, unknown> | null
  configuration: Record<string, unknown> | null
}

export function getLanguageProfiles() {
  return requestJson<LanguageProfilesPayload>("/code/language-profiles")
}

export function saveLanguageProfile(profile: LanguageProfile) {
  return requestJson<{ profile: LanguageProfile }>("/code/language-profiles/save", {
    method: "POST",
    body: JSON.stringify({ profile }),
  })
}

export function deleteLanguageProfile(profileId: string) {
  return requestJson<{ deleted: boolean }>("/code/language-profiles/delete", {
    method: "POST",
    body: JSON.stringify({ profile_id: profileId }),
  })
}

export function searchLanguageRegistry(query: string) {
  return requestJson<LanguageRegistrySearchPayload>(`/code/language-registry/search?query=${encodeURIComponent(query)}`)
}

export function installLanguagePack(payload: {
  extension: { id: string; version: string }
  runtime_id?: string
  language_server_id?: string
  language_id?: string
}) {
  return requestJson<LanguagePackInstallJob>("/code/language-registry/install", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function getLanguagePackInstallStatus(jobId: string) {
  return requestJson<LanguagePackInstallJob>(`/code/language-registry/install-status?job_id=${encodeURIComponent(jobId)}`)
}

export function getLanguageProfileAssets(profileId: string) {
  return requestJson<LanguageProfileAssets>(`/code/language-profiles/assets?profile_id=${encodeURIComponent(profileId)}`)
}
