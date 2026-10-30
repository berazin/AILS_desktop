import { createMaterialFile, createMaterialFolder, type LectureMaterialsPayload } from "../../../lib/api"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

export type WorkspaceEntryKind = "folder" | "md" | "txt"
export type CreatedWorkspaceEntry = { path: string; title: string; kind: "folder" | "MD" | "TXT" }

export function useWorkspaceEntryCreation(setMaterials: (materials: LectureMaterialsPayload) => void) {
  return useEventCallback(async (parentPath: string, kind: WorkspaceEntryKind): Promise<CreatedWorkspaceEntry> => {
    if (kind === "folder") {
      const result = await createMaterialFolder({ parent_path: parentPath, name: "새 폴더", unique: true })
      setMaterials(result.materials)
      return { path: result.folder.path, title: result.folder.name, kind: "folder" }
    }
    const result = await createMaterialFile({ parent_path: parentPath, kind, unique: true })
    setMaterials(result.materials)
    return { path: result.file.path, title: result.file.name, kind: kind === "md" ? "MD" : "TXT" }
  })
}
