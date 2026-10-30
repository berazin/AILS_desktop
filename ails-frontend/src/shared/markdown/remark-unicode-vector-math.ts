import { renderToString } from "katex"
import type { Code, Nodes, Root } from "mdast"
import type { VFile } from "vfile"
import type { Element, Root as HastRoot } from "hast"
import { inlineMathExpression } from "./inline-math-expression.ts"

function vectorExpression(node: Code, source: string) {
  if (node.meta || !["", "text", "plaintext", "txt"].includes(node.lang?.toLowerCase() ?? "")) return null
  // Indented code and explicitly named programming languages remain literal.
  const start = node.position?.start.offset
  if (start === undefined || !/^(?:`{3,}|~{3,})/.test(source.slice(start))) return null
  if (node.value.length > 4000) return null
  const lines = node.value.trim().split(/\r?\n/)
  if (!lines.length || lines.length > 32) return null
  const expressions: string[] = []
  for (const line of lines) {
    // Require an explicit Unicode vector on every line, without prose, API
    // calls, strings, comments or TeX commands mixed into the text example.
    if (!/[A-Za-z]\u20d7/.test(line) || /[A-Za-z]{2,}/.test(line)
      || /[^\p{Script=Latin}\p{Script=Greek}\p{Number}\p{Mark}\s()[\]{},.=+\-*/^_|<>!…−·×≈≥≤≠←→]/u.test(line)) return null
    const expression = inlineMathExpression(line)
    if (!expression) return null
    expressions.push(expression)
  }
  const expression = expressions.length === 1 ? expressions[0]
    : `\\begin{gathered}\n${expressions.join(String.raw` \\` + "\n")}\n\\end{gathered}`
  try {
    renderToString(expression, { displayMode: true, output: "mathml", strict: "ignore", trust: false, throwOnError: true })
    return expression
  } catch { return null }
}

/** Display vector-only text fences with KaTeX while retaining source identity. */
export function remarkUnicodeVectorMath() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value)
    function visit(node: Nodes) {
      if (node.type === "code") {
        const expression = vectorExpression(node, source)
        if (expression) node.data = { ...node.data, hName: "div",
          hProperties: { ...node.data?.hProperties, className: ["ails-vector-math"] },
          // KaTeX replaces the inner element. Keep an outer wrapper so the
          // original code node's source signature survives read/edit changes.
          hChildren: [{ type: "element", tagName: "span", properties: { className: ["math-display"] },
            children: [{ type: "text", value: expression }] }] }
      }
      if ("children" in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}

/** mdast's code handler adds a pre even when hName supplies our math wrapper. */
export function rehypeUnicodeVectorMath() {
  return (tree: HastRoot) => {
    function visit(node: HastRoot | Element) {
      for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index]
        if (child.type !== "element") continue
        const inner = child.children[0]
        if (child.tagName === "pre" && child.children.length === 1 && inner?.type === "element"
          && inner.tagName === "div" && Array.isArray(inner.properties.className) && inner.properties.className.includes("ails-vector-math")) {
          node.children[index] = inner
          visit(inner)
        } else visit(child)
      }
    }
    visit(tree)
  }
}
