import { extractViewerFilename } from "../../../lib/viewer-editing.ts"

export function removeImageFromMarkdown(content: string, src: string) {
  const filename = extractViewerFilename(src)
  if (!filename) return content
  const escaped = filename.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
  return content
    .replace(new RegExp(`!\\[[^\\]]*?\\]\\([^)]*?${escaped}[^)]*?\\)`, "gi"), "")
    .replace(new RegExp(`!\\[\\[[^\\]]*?${escaped}[^\\]]*?\\]\\]`, "gi"), "")
    .replace(new RegExp(`<img[^>]+?src=["'][^"']*?${escaped}[^"']*?["'][^>]*?>`, "gi"), "")
}

export type MarkdownImagePreview = {
  content: string
  rawContent: string
  currentContent: string
  hiddenImages: string[]
}

export function projectMarkdownImages(base: { content: string; rawContent: string; sources: string[] }, currentContent: string): MarkdownImagePreview | null {
  let original = base.rawContent, current = currentContent
  const hiddenImages: string[] = []
  for (const src of base.sources) {
    original = removeImageFromMarkdown(original, src)
    const stripped = removeImageFromMarkdown(current, src)
    if (stripped === current) hiddenImages.push(extractViewerFilename(src).toLowerCase())
    current = stripped
  }
  // Reuse the existing reader only for image removals/restorations. Text edits
  // must go through normal Markdown rendering with their own source anchors.
  return original === current ? { content: base.content, rawContent: base.rawContent, currentContent, hiddenImages } : null
}
