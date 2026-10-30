import { requestJson } from "./core.ts"

/* @ails-feature:developer_tools:start */
export interface PhoenixStatus {
  enabled: boolean
  configured: boolean
  sdk_available: boolean
  endpoint: string
  project_name: string
  last_error: string
}
/* @ails-feature:developer_tools:end */

/* @ails-feature:developer_tools:start */
export interface DeveloperToolStatus {
  id: string
  label: string
  description: string
  languages: string[]
  package_id: string
  recommended: boolean
  installed: boolean
  executable_path: string
  version: string
  install_supported: boolean
}

export interface DeveloperToolsPayload {
  platform: string
  winget_available: boolean
  tools: DeveloperToolStatus[]
}

export interface DeveloperToolInstallJob {
  job_id: string
  tool_id: string
  tool_label: string
  status: "queued" | "running" | "completed" | "failed"
  phase: "preparing" | "downloading" | "verifying" | "installing" | "completed" | "failed"
  progress_percent: number
  created_at: number
  started_at?: number | null
  finished_at?: number | null
  elapsed_seconds: number
  output: string
  error: string
  tool?: DeveloperToolStatus | null
  already_installed: boolean
  restart_recommended: boolean
}
/* @ails-feature:developer_tools:end */

/* @ails-feature:developer_tools:start */
export function getDeveloperTools(refresh = false) {
  return requestJson<DeveloperToolsPayload>(`/developer-tools${refresh ? "?refresh=1" : ""}`)
}

export function installDeveloperTool(toolId: string) {
  return requestJson<DeveloperToolInstallJob>("/developer-tools/install", {
    method: "POST",
    body: JSON.stringify({ tool_id: toolId }),
  })
}

export function getDeveloperToolInstallStatus(jobId: string) {
  return requestJson<DeveloperToolInstallJob>(`/developer-tools/install-status?job_id=${encodeURIComponent(jobId)}`)
}
/* @ails-feature:developer_tools:end */

/* @ails-feature:developer_tools:start */
export function getPhoenixStatus() {
  return requestJson<PhoenixStatus>("/phoenix/status")
}
/* @ails-feature:developer_tools:end */

export type PythonInstallation = { path: string; version: string; source: string }

export type PythonRuntimeStatus = {
  configured_path: string
  mode: string
  effective_path: string
  version: string
  resolution_error: string
  installations: PythonInstallation[]
  notebook_available: boolean
  venv_dir_name: string
  supported_versions: string[]
}

export function getPythonRuntimeStatus() {
  return requestJson<PythonRuntimeStatus>("/python/status")
}

export function validatePythonExecutable(path: string) {
  return requestJson<{ ok: boolean; path: string; version: string; error: string }>("/python/validate", {
    method: "POST",
    body: JSON.stringify({ path }),
  })
}
