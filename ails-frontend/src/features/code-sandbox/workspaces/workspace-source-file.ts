import { listWorkspaces, openWorkspace, workspaceRequest, type WorkspaceFile } from './api.ts'
import { IDE_ENABLED, DEVELOPER_TOOLS_ENABLED } from '../../../edition.ts'
import { getLanguageProfiles } from '../../../lib/api.ts'
import { isCodeFile } from '../lib/code-file-types.ts'

export const isWorkspaceSourceFile = isCodeFile

export async function shouldOpenSourceFile(path: string) {
  if (!IDE_ENABLED) return false
  if (isCodeFile(path)) return true
  // Dedicated readers keep ownership of documents, even if a custom language
  // happens to register their extension. Unknown source extensions use profiles.
  if (/\.(md|markdown|txt|pdf|ipynb|ppt|pptx|docx|xlsx|csv|hwp|hwpx|epub|mobi|azw3?|fb2|rtf)$/i.test(path) || !DEVELOPER_TOOLS_ENABLED) return false
  const profiles = await getLanguageProfiles().then(result => result.profiles).catch(() => [])
  return isCodeFile(path, profiles)
}

export async function loadWorkspaceSourceFile(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const { workspaces } = await listWorkspaces()
  const parent = workspaces.filter(item => item.available && normalized.toLowerCase().startsWith(
    item.path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() + '/',
  )).sort((a, b) => b.path.length - a.path.length)[0]
  const root = parent?.path ?? normalized.slice(0, normalized.lastIndexOf('/') + 1)
  const { workspace } = await openWorkspace(root, false, false, parent?.id)
  const relative = normalized.slice(workspace.path.replace(/\\/g, '/').replace(/\/$/, '').length + 1)
  const file = await workspaceRequest<WorkspaceFile>('read', { id: workspace.id, path: relative })
  return { workspace, file }
}
