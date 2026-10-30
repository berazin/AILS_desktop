import type { MarkdownSourceAnchor } from "./markdown-live-preview.ts"
import type { mountMarkdownLiveEditor } from "./markdown-live-editor.ts"

export type MarkdownContentAnchor = {start:number; end:number; offset:number; type:string; ratio:number; viewportY:number}
export type MarkdownLiveController = ReturnType<typeof mountMarkdownLiveEditor>

function imageIdentity(src:string) {
  try {
    const url = new URL(src, window.location.href)
    return (url.pathname.endsWith("/api/files") ? url.searchParams.get("path") ?? src : decodeURI(url.href)).replaceAll("\\", "/")
  } catch { return src }
}

/** Bind rendered semantics to the untouched source, including rewritten local image URLs. */
export function annotateMarkdownContent(root:HTMLElement, anchors:MarkdownSourceAnchor[], resolveImage:(src:string)=>string) {
  const signatures = new Map<string, MarkdownSourceAnchor[]>()
  const images = new Map<string, MarkdownSourceAnchor[]>()
  for (const anchor of anchors) {
    const group = signatures.get(anchor.signature) ?? []
    group.push(anchor); signatures.set(anchor.signature,group)
    if (anchor.type === "image" && anchor.url) {
      const key = imageIdentity(resolveImage(anchor.url))
      const group = images.get(key) ?? []
      group.push(anchor); images.set(key,group)
    }
  }
  const used = new Map<Element, Set<MarkdownSourceAnchor>>()
  for (const element of root.querySelectorAll<HTMLElement>("[data-ails-source-signature]")) {
    const host = element.closest<HTMLElement>("[data-ails-live-preview]")
    const scope = host ?? root
    const seen = used.get(scope) ?? new Set<MarkdownSourceAnchor>()
    used.set(scope,seen)
    const candidates = element instanceof HTMLImageElement
      ? images.get(imageIdentity(element.dataset.markdownImageSource ?? element.src)) ?? signatures.get(element.dataset.ailsSourceSignature ?? "")
      : signatures.get(element.dataset.ailsSourceSignature ?? "")
    const match = candidates?.find(anchor => !seen.has(anchor) && (!host ||
      (anchor.start >= Number(host.dataset.ailsSourceStart) && anchor.end <= Number(host.dataset.ailsSourceEnd))))
    if (!match) {
      delete element.dataset.ailsSourceStart; delete element.dataset.ailsSourceEnd; delete element.dataset.ailsSourceKind
      continue
    }
    seen.add(match)
    element.dataset.ailsSourceStart = String(match.start)
    element.dataset.ailsSourceEnd = String(match.end)
    element.dataset.ailsSourceKind = match.type
  }
}

function viewport(scroller:HTMLElement) {
  const rect = scroller.getBoundingClientRect()
  const header = scroller.querySelector<HTMLElement>("[data-ails-document-header]")?.getBoundingClientRect()
  return {top:Math.max(rect.top,header && header.top <= rect.top + 1 ? header.bottom : rect.top), bottom:rect.bottom, origin:rect.top}
}

export function captureMarkdownContent(root:HTMLElement, scroller:HTMLElement, controller:MarkdownLiveController | null):MarkdownContentAnchor | null {
  const view = viewport(scroller)
  let best: {anchor:MarkdownContentAnchor; gap:number; height:number} | null = null
  for (const element of root.querySelectorAll<HTMLElement>("[data-ails-source-kind]")) {
    const rect = element.getBoundingClientRect()
    if (!rect.height || rect.bottom <= view.top || rect.top >= view.bottom) continue
    const y = Math.max(view.top,rect.top)
    const gap = y - view.top
    if (best && (gap > best.gap || (gap === best.gap && rect.height >= best.height))) continue
    const start = Number(element.dataset.ailsSourceStart), end = Number(element.dataset.ailsSourceEnd)
    const ratio = Math.max(0,Math.min(1,(y - rect.top) / rect.height))
    const type = element.dataset.ailsSourceKind ?? "paragraph"
    best = {gap, height:rect.height, anchor:{start,end,type,ratio,viewportY:y-view.origin,
      offset:type === "image" ? start : start + Math.round((end-start)*ratio)}}
  }
  const source = controller?.sourceAtViewport(view.top,view.bottom)
  if (source && (!best || Math.max(view.top,source.top)-view.top <= best.gap)) {
    const y = Math.max(view.top,source.top)
    return {start:source.offset,end:source.offset,offset:source.offset,type:"source",
      ratio:(y-source.top)/source.height, viewportY:y-view.origin}
  }
  return best?.anchor ?? null
}

export function restoreMarkdownContent(root:HTMLElement, scroller:HTMLElement, controller:MarkdownLiveController | null, anchor:MarkdownContentAnchor) {
  const matches = Array.from(root.querySelectorAll<HTMLElement>("[data-ails-source-kind]")).filter(element => {
    const start = Number(element.dataset.ailsSourceStart), end = Number(element.dataset.ailsSourceEnd)
    return element.getBoundingClientRect().height > 0 && start <= anchor.offset && end >= anchor.offset
  }).sort((a,b) => {
    const kind = Number(b.dataset.ailsSourceKind === anchor.type) - Number(a.dataset.ailsSourceKind === anchor.type)
    return kind || (Number(a.dataset.ailsSourceEnd)-Number(a.dataset.ailsSourceStart)) - (Number(b.dataset.ailsSourceEnd)-Number(b.dataset.ailsSourceStart))
  })
  const element = matches[0]
  const rect = element?.getBoundingClientRect() ?? controller?.sourceRect(anchor.offset)
  if (!rect) return
  const ratio = element && anchor.type === "source"
    ? (anchor.offset-Number(element.dataset.ailsSourceStart)) / Math.max(1,Number(element.dataset.ailsSourceEnd)-Number(element.dataset.ailsSourceStart))
    : element ? anchor.ratio : 0
  const delta = rect.top + rect.height*ratio - (scroller.getBoundingClientRect().top + anchor.viewportY)
  if (Math.abs(delta) > .5) scroller.scrollTop += delta
}
