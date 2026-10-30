import { IDE_ENABLED } from "../edition.ts"
export { IDE_ENABLED }
export const IDE_DISABLED_MESSAGE = "상업판에서는 IDE·코드·노트북 파일을 사용할 수 없습니다. 기존 파일과 기록은 보존되며 개발판에서 열 수 있습니다."
export function documentAllowed(path: string) {
  if (IDE_ENABLED) return true
  const name = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? ""
  return !["cmakelists.txt", "requirements.txt"].includes(name) && /\.(md|markdown|txt|pdf|ppt|pptx|docx|xlsx|csv|hwp|hwpx|html|htm|epub|mobi|azw3?|fb2|rtf)$/.test(name)
}
export function requireDocument(path: string) {
  if (!documentAllowed(path)) throw new Error(IDE_DISABLED_MESSAGE)
}

export function hasUnavailableIdeSession(storage: Pick<Storage, "getItem">) {
  if (IDE_ENABLED) return false
  try {
    const raw = storage.getItem("ails-workspace-session-state-commercial") || storage.getItem("ails-workspace-session-state")
    const state = JSON.parse(raw || "null")
    return Boolean(state?.codeSandbox?.open && state.codeSandbox.mode === "code"
      || state?.material?.filePath && !documentAllowed(state.material.filePath))
  } catch { return false }
}
