import type { Nodes, PhrasingContent, Root } from 'mdast'

type Token = { node: PhrasingContent; marker: boolean }

/** Recover paired bold ending in punctuation/code immediately before Korean. */
export function remarkInlineEmphasis() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value)
    const escaped = (offset: number) => {
      let slashes = 0
      while (offset > 0 && source[--offset] === '\\') slashes += 1
      return slashes % 2 === 1
    }
    const repair = (children: PhrasingContent[]) => {
      const tokens: Token[] = []
      for (const node of children) {
        const start = node.position?.start.offset, end = node.position?.end.offset
        // Escapes/entities are decoded by the Markdown parser. Only interpret
        // literal source markers; never turn a displayed escape into formatting.
        if (node.type !== 'text' || !node.value.includes('**') || start == null || end == null || source.slice(start, end) !== node.value) {
          tokens.push({ node, marker: false }); continue
        }
        const textSlice = (from: number, to: number): PhrasingContent => {
          const point = (index: number) => {
            const prefix = node.value.slice(0, index), newline = prefix.lastIndexOf('\n')
            return { offset: start + index, line: node.position!.start.line + (prefix.match(/\n/g)?.length ?? 0),
              column: newline < 0 ? node.position!.start.column + index : index - newline }
          }
          return { type: 'text', value: node.value.slice(from, to), position: { start: point(from), end: point(to) } }
        }
        let cursor = 0
        for (const match of node.value.matchAll(/\*\*/g)) {
          const index = match.index
          if (node.value[index - 1] === '*' || node.value[index + 2] === '*' || escaped(start + index)) continue
          if (index > cursor) tokens.push({ node: textSlice(cursor, index), marker: false })
          tokens.push({ node: textSlice(index, index + 2), marker: true })
          cursor = index + 2
        }
        if (cursor < node.value.length) tokens.push({ node: textSlice(cursor, node.value.length), marker: false })
      }
      const output: PhrasingContent[] = []
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]
        if (!token.marker) { output.push(token.node); continue }
        let closing = index + 1
        while (closing < tokens.length && !tokens[closing].marker) closing += 1
        const first = tokens[index + 1]?.node, last = tokens[closing - 1]?.node
        if (closing >= tokens.length || closing === index + 1
          || (first?.type === 'text' && /^\s/.test(first.value))
          || (last?.type === 'text' && /\s$/.test(last.value))) {
          output.push(token.node); continue
        }
        const openPosition = token.node.position, closePosition = tokens[closing].node.position
        output.push({ type: 'strong', children: tokens.slice(index + 1, closing).map(part => part.node),
          ...(openPosition && closePosition ? { position: { start: openPosition.start, end: closePosition.end } } : {}) })
        index = closing
      }
      children.splice(0, children.length, ...output)
    }
    const visit = (node: Nodes) => {
      if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') repair(node.children)
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
    return tree
  }
}
