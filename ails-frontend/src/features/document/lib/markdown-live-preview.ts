import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import type { Nodes } from "mdast"
import { normalizeMarkdownImageSources } from "../../../shared/markdown/markdown-image-sources.ts"
import { markdownSourceSignature } from "../../../shared/markdown/markdown-source-anchors.ts"
import { remarkInlineEmphasis } from "../../../shared/markdown/remark-inline-emphasis.ts"
import { remarkCurrencyText } from "../../../shared/markdown/remark-currency-text.ts"

const parser = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath).use(remarkCurrencyText).use(remarkInlineEmphasis)
export type MarkdownPreviewRange = {
  key: string
  source: string
  imageSource: string
  start: number
  end: number
  startLine: number
  endLine: number
  type: string
}
export type MarkdownSourceAnchor = {start:number; end:number; signature:string; type:string; url?:string}

// Positions are annotations over a single source document, never independent editable values.
export function markdownPreviewRanges(content: string) {
  const normalized = normalizeMarkdownImageSources(content)
  const tree = parser.runSync(parser.parse(normalized.content), { value: normalized.content })
  const anchors: MarkdownSourceAnchor[] = []
  function visit(node: Nodes, images?:string[]) {
    if (node.position) {
      const start = node.position.start.offset ?? 0
      const end = node.position.end.offset ?? start
      anchors.push({start:normalized.sourceOffset(start), end:normalized.sourceOffset(end),
        signature:markdownSourceSignature(node), type:node.type, url:"url" in node ? node.url : undefined})
      if (node.type === "image" || node.type === "imageReference") images?.push(normalized.content.slice(start,end))
    }
    if ("children" in node) node.children.forEach(child => visit(child, images))
  }
  const definitions = tree.children.filter(node => node.type === "definition")
    .map(node => normalized.content.slice(node.position?.start.offset, node.position?.end.offset)).join("\n")
  const occurrences = new Map<string, number>()
  const ranges: MarkdownPreviewRange[] = []
  for (const node of tree.children) {
    if (!node.position || node.type === "definition") continue
    const start = node.position.start.offset ?? 0
    const end = node.position.end.offset ?? start
    const source = normalized.content.slice(start, end)
    const images: string[] = []
    visit(node, images)
    const ordinal = occurrences.get(source) ?? 0
    occurrences.set(source, ordinal + 1)
    ranges.push({key: `${source}\u0000${ordinal}`, source, imageSource:images.join("\n\n"), start:normalized.sourceOffset(start), end:normalized.sourceOffset(end),
      startLine: node.position.start.line, endLine: node.position.end.line, type: node.type})
  }
  return { ranges, definitions, anchors }
}

export function previewRangeIsSelected(range: MarkdownPreviewRange, startLine: number, endLine: number) {
  return range.startLine <= endLine && range.endLine >= startLine
}

export function hiddenPreviewLines(lineCount: number, ranges: MarkdownPreviewRange[], selections: Array<{startLineNumber: number; endLineNumber: number}>) {
  const visible = new Set<number>()
  for (const selection of selections) {
    for (let line = selection.startLineNumber; line <= selection.endLineNumber; line++) visible.add(line)
    for (const range of ranges) {
      if (previewRangeIsSelected(range, selection.startLineNumber, selection.endLineNumber)) {
        for (let line = range.startLine; line <= range.endLine; line++) visible.add(line)
      }
    }
  }
  const hidden: Array<{startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number}> = []
  for (let line = 1; line <= lineCount; line++) {
    if (visible.has(line)) continue
    const start = line
    while (line < lineCount && !visible.has(line + 1)) line++
    hidden.push({startLineNumber:start, startColumn:1, endLineNumber:line, endColumn:1})
  }
  return hidden
}
