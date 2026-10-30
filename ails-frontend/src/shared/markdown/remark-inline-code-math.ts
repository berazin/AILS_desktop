import { renderToString } from "katex"
import type { Nodes, Root } from "mdast"
import { inlineMathExpression, isMathProse } from "./inline-math-expression.ts"

const candidates = new Map<string, boolean>()

function isInlineFormula(value: string) {
  const cached = candidates.get(value)
  if (cached !== undefined) return cached
  let valid = false
  try {
    // Invalid/unsupported TeX stays readable as code; use the viewer's safe defaults.
    renderToString(value, { output: "mathml", strict: "ignore", trust: false, throwOnError: true })
    valid = true
  } catch { /* Incomplete editor input remains literal. */ }
  candidates.set(value, valid)
  if (candidates.size > 256) candidates.delete(candidates.keys().next().value!)
  return valid
}

/** Render clearly mathematical code spans through the existing KaTeX pipeline. */
export function remarkInlineCodeMath() {
  return (tree: Root) => {
    const text = (child: Nodes): string => "value" in child ? child.value : "children" in child ? child.children.map(text).join(" ") : ""
    function visit(node: Nodes, inheritedContext = false) {
      const mathProse = ["paragraph", "heading", "tableCell"].includes(node.type) ? isMathProse(text(node)) : inheritedContext
      if ("children" in node) for (const child of node.children) {
        if (child.type !== "inlineCode") continue
        const expression = inlineMathExpression(child.value, mathProse)
        if (!expression || !isInlineFormula(expression)) continue
        // Keep the original node/value/position so live-editor source anchors agree.
        child.data = { ...child.data, hProperties: { ...child.data?.hProperties, className: ["language-math", "math-inline"] },
          hChildren: [{ type: "text", value: expression }] }
      }
      if ("children" in node) node.children.forEach(child => visit(child, mathProse))
    }
    visit(tree)
  }
}
