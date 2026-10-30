import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import type { CodeHighlightProps } from "./deferred-code-highlight.tsx"

export function CodeHighlight(props: CodeHighlightProps) {
  return <SyntaxHighlighter {...props} PreTag="div" style={vscDarkPlus} />
}
