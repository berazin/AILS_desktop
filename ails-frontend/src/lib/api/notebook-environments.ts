import { requestJson, requestNdjsonStream } from "./core.ts"

export type NotebookEnvironment = { id: string; name: string; python: string; managed: boolean; version?: string }
export type NotebookEnvironmentStatus = {
  selected_id: string; environments: NotebookEnvironment[]; data_root: string; bundle_available: boolean
}
export type NotebookPackage = { name: string; version: string; summary?: string; requires_python?: string }
export function notebookEnvironment<T>(path: string, action: string, options: Record<string, unknown> = {}, signal?: AbortSignal) {
  return requestJson<T>("/material-file/notebook/environment", { method: "POST", signal, body: JSON.stringify({ path, action, ...options }) })
}
export async function changeNotebookPackages(path: string, action: "install" | "uninstall", packages: string[], onLog: (text: string) => void) {
  let result: { ok: boolean; log?: string; conflicts?: string; restart_required?: boolean; packages?: NotebookPackage[] } | undefined
  await requestNdjsonStream<{ type: string; ok?: boolean; text?: string; message?: string; log?: string; conflicts?: string; restart_required?: boolean; packages?: NotebookPackage[] }>("/material-file/notebook/packages", {
    method: "POST", body: JSON.stringify({ path, action, packages }), onEvent: event => {
      if (event.type === "done") result = { ...event, ok: Boolean(event.ok) }
      else if (event.type === "log") onLog(event.text ?? "")
      else if (event.type === "status") onLog(`${event.message ?? "진행 중"}\n`)
    },
  })
  if (!result) throw new Error("패키지 작업 응답이 끊겼습니다. 설치 목록을 새로고침해 주세요.")
  return result
}
