import type { Root, RootContent } from 'mdast'

// Teaching notebooks sometimes indent spacer-only HTML by four spaces.
// CommonMark interprets that as code; only reinterpret blocks containing br tags.
export function remarkNotebookLineBreaks() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value)
    function visit(parent: { children: RootContent[] }) {
      parent.children.forEach((node, index) => {
        if (node.type === 'code' && /^(?:\s*<br\s*\/?\s*>\s*)+$/i.test(node.value)) {
          const original = source.slice(node.position?.start.offset, node.position?.end.offset)
          // Explicitly fenced examples remain literal, even without a language.
          if (!/^\s*(?:`{3,}|~{3,})/.test(original)) {
            parent.children[index] = { type: 'html', value: node.value, position: node.position }
          }
        } else if ('children' in node) visit(node as { children: RootContent[] })
      })
    }
    visit(tree)
  }
}

export const notebookMarkdownPlugins = [remarkNotebookLineBreaks]
