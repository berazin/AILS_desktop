import { defaultSchema, type Options } from "rehype-sanitize"

// JupyterLab renders raw HTML inside markdown cells but sanitizes it to a safe
// subset: rich layout tags and inline styles survive, scriptable elements and
// event handlers are dropped. The schema below mirrors that policy.
export const notebookRawHtmlSchema: Options = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "center",
    "font",
    "audio",
    "source",
    "picture",
    "section",
    "article",
    "main",
    "address",
    "figure",
    "figcaption",
    "details",
    "summary",
    "dialog",
    "caption",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "style", "className", "align", "dir", "id", "title", "width", "height", "bgcolor"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "loading", "decoding", "sizes"],
    video: [...(defaultSchema.attributes?.video ?? []), "controls", "autoplay", "loop", "muted", "preload", "poster", "playsinline"],
    audio: [...(defaultSchema.attributes?.audio ?? []), "controls", "autoplay", "loop", "muted", "preload"],
    source: [...(defaultSchema.attributes?.source ?? []), "media", "type"],
    table: [...(defaultSchema.attributes?.table ?? []), "border", "cellpadding", "cellspacing", "align", "summary"],
    tr: [...(defaultSchema.attributes?.tr ?? []), "align", "valign"],
    td: [...(defaultSchema.attributes?.td ?? []), "align", "valign", "colspan", "rowspan", "scope"],
    th: [...(defaultSchema.attributes?.th ?? []), "align", "valign", "colspan", "rowspan", "scope"],
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel", "name"],
    ol: ["start", "type", "reversed"],
    li: ["value"],
  },
  // Scriptable elements disappear together with their content instead of
  // leaking their text into the document.
  strip: [...(defaultSchema.strip ?? []), "script", "style", "iframe", "object", "embed", "link", "meta", "base", "form"],
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data"],
  },
}

type HastLikeNode = {
  type?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastLikeNode[]
}

// hast carries `style` as a raw declaration string, but React's style prop
// expects an object. Convert it so styled raw HTML renders instead of crashing
// the element renderer.
export function parseHastStyleValue(style: string): Record<string, string> {
  const declarations: Record<string, string> = {}
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":")
    if (separator <= 0) continue
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const value = declaration.slice(separator + 1).trim()
    if (!property || !value) continue
    const camelProperty = property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
    declarations[camelProperty] = value
  }
  return declarations
}

// Runs after rehype-sanitize (which keeps `style` only as a string and drops
// object values) and before rehype-katex in the notebook pipeline.
export function rehypeHastStyleObject() {
  return (tree: HastLikeNode) => {
    const visit = (node: HastLikeNode) => {
      if (typeof node !== "object" || node === null) return
      if (typeof node.properties?.style === "string") {
        node.properties.style = parseHastStyleValue(node.properties.style)
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) visit(child)
      }
    }
    visit(tree)
  }
}
