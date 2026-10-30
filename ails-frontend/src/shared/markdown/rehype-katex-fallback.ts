import rehypeKatex, { type Options } from "rehype-katex"
import type { Element, Root } from "hast"
import type { VFile } from "vfile"

const mathCache = new Map<string, { children: Root["children"]; size: number }>()
let cacheSize = 0
const MAX_CACHE_SIZE = 4 * 1024 * 1024
const MAX_CACHE_ENTRIES = 128

function isMath(node: Root["children"][number]): boolean {
  if (node.type !== "element") return false
  const classes = node.properties.className
  return Array.isArray(classes) && classes.some(value =>
    value === "language-math" || value === "math-display" || value === "math-inline")
}

/** Keep unsupported glyphs visible using native MathML instead of zero-size HTML metrics. */
export default function rehypeKatexFallback(options?: Options) {
  const renderHtml = rehypeKatex(options)
  const renderMathMl = rehypeKatex({ ...options, output: "mathml" })
  // Our viewer uses immutable strict:"ignore" settings. Dynamic callbacks and
  // mutable macro definitions must always execute rather than reuse a result.
  const cacheOptions = !options || Object.keys(options).every(key => key === "strict")
    && typeof options.strict !== "function" ? JSON.stringify(options ?? {}) : null
  return (tree: Root, file: VFile) => {
    const visit = (parent: Root | Element) => {
      for (let index = 0; index < parent.children.length; index++) {
        const node = parent.children[index]
        const math = isMath(node) || (node.type === "element" && node.tagName === "pre"
          && node.children.some(child => isMath(child)))
        if (!math) {
          if (node.type === "element") visit(node)
          continue
        }
        const key = cacheOptions === null ? null : `${cacheOptions}:${JSON.stringify(node)}`
        const cached = key === null ? undefined : mathCache.get(key)
        if (cached && key !== null) {
          mathCache.delete(key)
          mathCache.set(key, cached)
          const children = structuredClone(cached.children)
          parent.children.splice(index, 1, ...children as Element["children"])
          index += children.length - 1
          continue
        }
        const original = structuredClone(node)
        const scope: Root = { type: "root", children: [node] }
        let missingMetrics = false
        const warn = console.warn
        const messageCount = file.messages.length
        // KaTeX 0.16 emits this warning directly, even with strict: "ignore".
        // Rendering is synchronous: restore the logger before native fallback.
        console.warn = (...args: unknown[]) => {
          if (typeof args[0] === "string" && args[0].startsWith("No character metrics for '")) {
            missingMetrics = true
          } else {
            warn.apply(console, args)
          }
        }
        try {
          renderHtml(scope, file)
        } finally {
          console.warn = warn
        }
        if (missingMetrics) {
          scope.children = [original]
          renderMathMl(scope, file)
        }
        if (key !== null && file.messages.length === messageCount) {
          const size = (key.length + JSON.stringify(scope.children).length) * 2
          if (size <= MAX_CACHE_SIZE) {
            mathCache.set(key, { children: structuredClone(scope.children), size })
            cacheSize += size
            while (cacheSize > MAX_CACHE_SIZE || mathCache.size > MAX_CACHE_ENTRIES) {
              const oldest = mathCache.keys().next().value!
              cacheSize -= mathCache.get(oldest)!.size
              mathCache.delete(oldest)
            }
          }
        }
        parent.children.splice(index, 1, ...scope.children as Element["children"])
        index += scope.children.length - 1
      }
    }
    visit(tree)
  }
}
