import { DEVELOPER_TOOLS_ENABLED } from "../../../edition.ts"
import { getLanguageProfiles } from "../../../lib/api.ts"
import { getLanguageTemplate } from "../lib/code-sandbox-support.ts"
import { createWorkspace, workspaceRequest, type WorkspaceFile } from "./api.ts"

export function validateFirstFileName(name: string): string {
  if (!name || name === "." || name === ".." || /[<>:"/\\|?*]/.test(name) || Array.from(name).some(character => character.charCodeAt(0) < 32) || /[. ]$/.test(name) || name.length > 255) {
    return "경로를 제외한 올바른 파일 이름을 입력하세요."
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || [".link", ".ails"].includes(name.toLowerCase())) {
    return "이 이름은 사용할 수 없습니다. 다른 파일 이름을 입력하세요."
  }
  return ""
}

export async function createWorkspaceWithFirstFile(name: string) {
  const error = validateFirstFileName(name)
  if (error) throw new Error(error)
  const profiles = DEVELOPER_TOOLS_ENABLED ? await getLanguageProfiles().then(result => result.profiles).catch(() => []) : []
  const text = getLanguageTemplate(name, profiles)
  const result = await createWorkspace()
  try {
    await workspaceRequest("create", { id: result.workspace.id, path: name, text })
    const firstFile = await workspaceRequest<WorkspaceFile>("read", { id: result.workspace.id, path: name })
    return { workspace: result.workspace, firstFile }
  } catch (reason) {
    throw new Error(`${result.workspace.path}: 첫 파일을 만들거나 열지 못했습니다. ${String(reason)}`, { cause: reason })
  }
}
