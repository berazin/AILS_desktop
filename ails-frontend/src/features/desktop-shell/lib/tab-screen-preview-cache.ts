import type { TabScreenPreview } from "../../../shared/tab-screen-preview.ts"

export function createTabScreenPreviewCache(limit = 40, byteLimit = 4 * 1024 * 1024) {
  const entries = new Map<string, { key: string; image: TabScreenPreview }>()
  let bytes = 0
  const remove = (id: string) => {
    const old = entries.get(id)
    if (old) bytes -= old.image.dataUrl.length
    entries.delete(id)
  }
  return {
    get(id: string, key: string) { const entry = entries.get(id); return entry?.key === key ? entry.image : null },
    set(ids: string[], key: string, image: TabScreenPreview) {
      if (!image.dataUrl.startsWith("data:image/jpeg;base64,") || image.dataUrl.length > byteLimit) return
      for (const id of ids) { remove(id); entries.set(id, { key, image }); bytes += image.dataUrl.length }
      while (entries.size > limit || bytes > byteLimit) remove(entries.keys().next().value!)
    },
    prune(keys: Map<string, string>) { for (const [id, entry] of entries) if (keys.get(id) !== entry.key) remove(id) },
    clear() { entries.clear(); bytes = 0 },
  }
}
