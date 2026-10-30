import type { Nodes, PhrasingContent, Root } from "mdast"

/** A pair of dollar amounts in cost prose is currency, not one long formula. */
export function remarkCurrencyText() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value)
    function visit(node: Nodes) {
      if (!("children" in node)) return
      for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index]
        if (child.type === "inlineMath" && /^\d[\d.,]*(?:\s|[kKmMbB]|['’])/.test(child.value)
          && /₩|달러|\b(?:price|cost|USD)\b|약\s*[\d₩]|비용|청구/.test(child.value)) {
          const start = child.position?.start.offset, end = child.position?.end.offset
          if (start !== undefined && end !== undefined) {
            const raw = source.slice(start, end), parts: PhrasingContent[] = []
            const point = (offset: number) => {
              const prefix = raw.slice(0, offset), newline = prefix.lastIndexOf('\n')
              return { offset: start + offset, line: child.position!.start.line + (prefix.match(/\n/g)?.length ?? 0),
                column: newline < 0 ? child.position!.start.column + offset : offset - newline }
            }
            const position = (from: number, to: number) => ({ start: point(from), end: point(to) })
            let cursor = 0
            for (const match of raw.matchAll(/(?: {2,}|\\)\r?\n/g)) {
              if (match.index > cursor) parts.push({ type: 'text', value: raw.slice(cursor, match.index), position: position(cursor, match.index) })
              cursor = match.index + match[0].length
              parts.push({ type: 'break', position: position(match.index, cursor) })
            }
            if (cursor < raw.length) parts.push({ type: 'text', value: raw.slice(cursor), position: position(cursor, raw.length) })
            node.children.splice(index, 1, ...parts)
            index += parts.length - 1
          }
        }
        visit(node.children[index])
      }
    }
    visit(tree)
    return tree
  }
}
