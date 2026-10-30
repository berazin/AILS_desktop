import { markdownUrlTransform } from "../../../shared/markdown/markdown-url-transform.ts"

// A pending draft still contains disk-relative image paths, before the save API rewrites them.
export function draftPreviewUrlTransform(value: string, key: string, documentPath: string) {
  const source = value.trim()
  if (!source || key !== "src" || !documentPath || /^(?:https?:|data:|\/api\/|\/\/|#)/i.test(source)) return markdownUrlTransform(value)
  if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) return markdownUrlTransform(value)
  try {
    const filePath = documentPath.replaceAll("\\", "/")
    const base = new URL(filePath.startsWith("//") ? `file:${filePath}` : `file:///${filePath}`)
    const imageSource = source.replaceAll("\\", "/")
    const image = new URL(/^[a-z]:\//i.test(imageSource) ? `file:///${imageSource}` : imageSource, base)
    const path = image.host ? `//${image.host}${decodeURIComponent(image.pathname)}`
      : decodeURIComponent(image.pathname).replace(/^\/([a-z]:\/)/i, "$1")
    return `/api/files?path=${encodeURIComponent(path)}`
  } catch { return markdownUrlTransform(value) }
}
