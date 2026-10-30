const IGNORED = "script,style,noscript,svg,input,textarea,select,button,[role='button'],[contenteditable='true'],.monaco-editor,.katex-mathml,[data-ails-document-search-ignore]"
const BLOCKS = "p,pre,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,div,section,article"

/** Read rendered text without rewriting React's DOM, links, code or selections. */
export function findDocumentRanges(root: HTMLElement, query: string, options: TextSearchOptions = { wholeWord: false, regex: false }): Range[] {
  if (!query.trim()) return []
  const { pattern } = textSearchPattern(query, options)
  if (!pattern) return []
  const visibility = new WeakMap<Element, boolean>()
  const visible = (element: Element): boolean => {
    const cached = visibility.get(element)
    if (cached !== undefined) return cached
    const style = getComputedStyle(element)
    // aria-hidden alone can mark a visible syntax/math layer, so use its actual
    // layout visibility rather than its accessibility-tree visibility.
    const result = !element.matches(IGNORED + ",[hidden],[inert]")
      && style.display !== "none" && style.visibility !== "hidden"
      && (element === root || !element.parentElement || visible(element.parentElement))
    visibility.set(element, result)
    return result
  }
  const groups: { block: Element; text: string; nodes: { node: Text; start: number; end: number }[] }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement && visible(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.length) continue
    const block = node.parentElement!.closest(BLOCKS) ?? root
    let group = groups.at(-1)
    if (!group || group.block !== block) { group = { block, text: "", nodes: [] }; groups.push(group) }
    group.nodes.push({ node, start: group.text.length, end: group.text.length + node.length })
    group.text += node.data
  }
  const ranges: Range[] = []
  for (const group of groups) for (const match of textSearchMatches(group.text, pattern, options.wholeWord)) {
    const start = group.nodes.find(part => part.start <= match.start && part.end > match.start)
    const endIndex = match.end
    const end = group.nodes.find(part => part.start < endIndex && part.end >= endIndex)
    if (!start || !end) continue
    const range = document.createRange()
    range.setStart(start.node, match.start - start.start)
    range.setEnd(end.node, endIndex - end.start)
    ranges.push(range)
  }
  return ranges
}

export function revealDocumentRange(range: Range, container: HTMLElement) {
  // Only scroll inside the reader, leaving the process bar and other panes still.
  for (let element = range.startContainer.parentElement; element; element = element.parentElement) {
    if (element === container || /(auto|scroll)/.test(getComputedStyle(element).overflow)) {
      const match = range.getBoundingClientRect(), bounds = element.getBoundingClientRect()
      if (match.top < bounds.top + 64 || match.bottom > bounds.bottom - 16) element.scrollTop += match.top - bounds.top - Math.max(64, (element.clientHeight - match.height) / 2)
      if (match.left < bounds.left || match.right > bounds.right) element.scrollLeft += match.left - bounds.left - 16
    }
    if (element === container) break
  }
}
import { textSearchMatches, textSearchPattern, type TextSearchOptions } from "../../../shared/lib/text-search.ts"
