import { normalizedMaterialPath, type SiblingNavigationResult } from "../../../lib/material-navigation.ts"

/** Keep the existing folder order, skipping every non-PDF file. */
export function pdfSiblingNavigation(siblings: SiblingNavigationResult, currentPath: string): SiblingNavigationResult {
  const files = siblings.files?.filter((file) => file.kind === "pdf")
  if (files) {
    const key = normalizedMaterialPath(currentPath).toLowerCase()
    const index = files.findIndex((file) => normalizedMaterialPath(file.path).toLowerCase() === key)
    return {
      previous: index > 0 ? files[index - 1] : null,
      next: index >= 0 ? files[index + 1] ?? null : null,
      files,
    }
  }
  return {
    previous: siblings.previous?.kind === "pdf" ? siblings.previous : null,
    next: siblings.next?.kind === "pdf" ? siblings.next : null,
  }
}
