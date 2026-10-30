import type { Root, Nodes } from "mdast"

const anchoredTypes = new Set(["heading", "paragraph", "image", "imageReference", "listItem", "table", "tableRow", "tableCell", "code", "math", "blockquote", "thematicBreak"])
export function markdownSourceSignature(node: {type:string; value?:string; alt?:string | null; children?:unknown[]}) {
  function text(value: unknown): string {
    const child = value as {value?:string; alt?:string; children?:unknown[]}
    return child.value ?? child.alt ?? child.children?.map(text).join(" ") ?? ""
  }
  const type = node.type === "imageReference" ? "image" : node.type
  return `${type}:${text(node).replace(/\s+/g, " ").trim()}`
}

/** Semantic identities survive backend URL rewriting and callout preprocessing. */
export function remarkSourceAnchors() {
  return (tree: Root) => {
    function visit(node: Nodes) {
      if (anchoredTypes.has(node.type)) {
        node.data ??= {}
        node.data.hProperties = {...node.data.hProperties, "data-ails-source-signature":markdownSourceSignature(node)}
      }
      if ("children" in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}

export function markdownAnchorAttributes(props: Record<string, unknown>) {
  return {"data-ails-source-signature":props["data-ails-source-signature"] as string | undefined}
}
