/** Keep unsaved practice drafts readable after the system folder rename. */
export function readCodeProjectDraft(storage: Pick<Storage, "getItem">, baseDir: string, projectName: string): string | null {
  const legacy = baseDir.replace(/(^|[/\\])\.(codes|([^/\\]+)\.codes)(?=$|[/\\])/g,
    (_match, prefix: string, name: string, title: string | undefined) => `${prefix}${title ? `${title}_codes` : `_${name}`}`)
  const directories = [...new Set([baseDir, legacy, legacy.replace(/\\/g, "/"), legacy.replace(/\//g, "\\")])]
  for (const directory of directories) {
    const saved = storage.getItem(`ails_draft_${directory}_${projectName.trim()}`)
    if (saved !== null) return saved
  }
  return null
}
