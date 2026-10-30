type Entry = {
  users: number
  bytes: number
  url?: string
  controller: AbortController
  ready: Promise<string>
}

/** Keep recently displayed local images decoded across deletion/undo remounts. */
export function createMarkdownImageCache(maxBytes = 32 * 1024 * 1024, maxEntries = 128) {
  const entries = new Map<string, Entry>()
  let bytes = 0
  const trim = () => {
    for (const [key, entry] of entries) {
      if (bytes <= maxBytes && entries.size <= maxEntries) break
      // A rendered image owns its URL until its last consumer unmounts.
      if (entry.users || !entry.url) continue
      URL.revokeObjectURL(entry.url)
      bytes -= entry.bytes
      entries.delete(key)
    }
  }
  return {
    peek: (key: string) => entries.get(key)?.url,
    acquire(key: string, load: (signal: AbortSignal) => Promise<Blob>) {
      let entry = entries.get(key)
      if (!entry) {
        const controller = new AbortController()
        entry = { users: 0, bytes: 0, controller, ready: Promise.resolve("") }
        const created = entry
        created.ready = Promise.resolve().then(() => load(controller.signal)).then(blob => {
          if (controller.signal.aborted) throw new DOMException("Image load cancelled", "AbortError")
          created.url = URL.createObjectURL(blob)
          created.bytes = blob.size
          bytes += blob.size
          trim()
          return created.url
        }).catch(error => {
          if (entries.get(key) === created) entries.delete(key)
          throw error
        })
      }
      entries.delete(key)
      entries.set(key, entry)
      entry.users += 1
      let released = false
      return {
        ready: entry.ready,
        release() {
          if (released) return
          released = true
          entry.users -= 1
          if (!entry.users && !entry.url) {
            entry.controller.abort()
            if (entries.get(key) === entry) entries.delete(key)
          }
          trim()
        },
      }
    },
  }
}

export const markdownImageCache = createMarkdownImageCache()

// Saved Markdown uses Windows separators; an unsaved preview uses URL slashes.
// They refer to the same file and must share the warmed image after Ctrl+Z.
export function markdownImageCacheKey(resourceUrl: string, headers: Record<string, string>) {
  const url = new URL(resourceUrl, "http://ails.local")
  const path = url.searchParams.get("path")
  if (path) url.searchParams.set("path", path.replaceAll("\\", "/"))
  return JSON.stringify([url.href, headers])
}
