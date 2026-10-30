import { useContext, useEffect, useState, type ImgHTMLAttributes } from "react"
import { apiHeaders, apiResourceUrl } from "../../lib/api/core.ts"
import { markdownImageCache, markdownImageCacheKey } from "../markdown/markdown-image-cache.ts"
import { MarkdownImageVisibility } from "../markdown/markdown-image-visibility.ts"
import { extractViewerFilename } from "../../lib/viewer-editing.ts"

// Local material images need the same authenticated transport as document reads.
// Never attach local API credentials to arbitrary Markdown/external URLs.
export function MarkdownImage({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const hiddenImages = useContext(MarkdownImageVisibility)
  const hidden = hiddenImages.has(extractViewerFilename(src ?? "").toLowerCase())
  const local = typeof src === "string" && src.startsWith("/api/files?")
  const resourceUrl = local ? apiResourceUrl(src.slice(4)) : ""
  const cacheKey = local ? markdownImageCacheKey(resourceUrl, apiHeaders()) : ""
  const [loaded, setLoaded] = useState<{ source: string; url: string }>()
  const [failed, setFailed] = useState("")
  useEffect(() => {
    if (!local || !src) return
    let active = true
    const lease = markdownImageCache.acquire(cacheKey, async signal => {
      const response = await fetch(resourceUrl, { headers: apiHeaders(), signal })
      if (!response.ok) throw new Error(`Image: ${response.status}`)
      return response.blob()
    })
    void lease.ready.then(url => {
      if (active) setLoaded({ source: cacheKey, url })
    }).catch(() => { if (active) setFailed(cacheKey) })
    return () => { active = false; lease.release() }
  }, [cacheKey, local, resourceUrl, src])
  const readyUrl = local ? markdownImageCache.peek(cacheKey) ?? (loaded?.source === cacheKey ? loaded.url : undefined) : src
  if (local && failed === cacheKey && !readyUrl && !hidden) return <span className="text-xs text-[var(--muted-foreground)]">{alt || "이미지"} · 이미지를 불러오지 못했습니다.</span>
  return <img {...props} alt={alt} data-markdown-image-source={src} data-markdown-image-hidden={hidden || undefined}
    style={hidden ? { ...props.style, display: "none" } : props.style} src={readyUrl} />
}
