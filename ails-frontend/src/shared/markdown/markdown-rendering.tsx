import { markdownAnchorAttributes } from "./markdown-source-anchors.ts"
import { t } from "../../lib/i18n.ts"
import type { AnchorHTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode } from "react"
import { Children, cloneElement, isValidElement, Fragment } from "react"
import { CalloutBlock } from "../components/markdown-callout.tsx"
import { MarkdownImage } from "../components/markdown-image.tsx"
import type { Components } from "react-markdown"
import { DeferredCodeHighlight } from "./deferred-code-highlight.tsx"

function processHighlights(node: ReactNode, onHighlightContextMenu?: (text: string, event: ReactMouseEvent<HTMLElement>) => void): ReactNode {
  if (typeof node === "string") {
    if (!node.includes("==")) return node
    const parts = node.split("==")
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return (
          <mark
            key={index}
            className="bg-amber-100 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 px-1.5 py-0.5 rounded font-semibold border-b border-amber-300 dark:border-amber-700"
            onContextMenu={(event) => onHighlightContextMenu?.(part, event)}
          >
            {part}
          </mark>
        )
      }
      return part
    })
  }
  if (Array.isArray(node)) {
    return node.map((child, idx) => <Fragment key={idx}>{processHighlights(child, onHighlightContextMenu)}</Fragment>)
  }
  if (isValidElement<{ className?: string; children?: ReactNode }>(node)) {
    const tag = typeof node.type === "string" ? node.type.toLowerCase() : ""
    const props = node.props
    const className = String(props?.className || "")
    if (tag === "pre" || tag === "code" || className.includes("katex") || className.includes("math")) {
      return node
    }

    const children = props?.children
    if (children) {
      const mappedChildren = Children.map(children, (child) => processHighlights(child, onHighlightContextMenu))
      return cloneElement(node, { children: mappedChildren })
    }
  }
  return node
}

const calloutMeta: Record<string, { label: string; className: string }> = {
  note: {
    label: "Note",
    className: "border-blue-300 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950/35 dark:text-blue-100",
  },
  tip: {
    label: "Tip",
    className:
      "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-100",
  },
  important: {
    label: "Important",
    className:
      "border-purple-300 bg-purple-50 text-purple-950 dark:border-purple-800 dark:bg-purple-950/35 dark:text-purple-100",
  },
  warning: {
    label: "Warning",
    className:
      "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100",
  },
  caution: {
    label: "Caution",
    className: "border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/35 dark:text-red-100",
  },
  "ai 사용량(추정)": {
    label: "AI 사용량(추정)",
    className:
      "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/35 dark:text-sky-100",
  },
  정답확인: {
    label: "정답확인",
    className:
      "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-100",
  },
}

const calloutMarkerPattern = /^\s*\[!([^\]]+)\]([+-])?\s*(.*)$/i
const encodedCalloutPattern = /\[\[AILS_CALLOUT:([A-Za-z0-9+/=]+)\]\]([\s\S]*?)\[\[\/AILS_CALLOUT\]\]/g
const looseLatexCommandPattern = /\\(?:underbrace|frac|partial|sigma|cdot|hat|log|sum|sqrt|begin|end|left|right|text|mathbf|mathbb|mathrm)\b/

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ""
}

function parseCallout(children: ReactNode) {
  const childArray = Children.toArray(children).filter((child) => typeof child !== "string" || child.trim())
  const firstChild = childArray[0]

  if (!isValidElement<{ children?: ReactNode }>(firstChild)) {
    return null
  }

  const paragraphChildren = Children.toArray(firstChild.props.children)
  const markerText = nodeText(paragraphChildren)
  if (!markerText) {
    return null
  }

  const match = calloutMarkerPattern.exec(markerText.split(/\r?\n/, 1)[0])
  if (!match) {
    return null
  }

  const rawType = match[1].trim()
  const type = rawType.toLowerCase()
  const title = match[3].trim() || (calloutMeta[type]?.label ? t(calloutMeta[type].label) : "") || rawType
  const defaultOpen = match[2] !== "-"
  let markerRemoved = false
  const nextParagraphChildren = paragraphChildren
    .map((child) => {
      if (markerRemoved || typeof child !== "string") return child
      const childMatch = calloutMarkerPattern.exec(child.split(/\r?\n/, 1)[0])
      if (!childMatch) return child
      markerRemoved = true
      const rest = child.slice(childMatch[0].length)
      return rest || null
    })
    .filter((child): child is Exclude<typeof child, null> => child !== null)
  const nextChildren = [
    cloneElement(firstChild, {
      children: nextParagraphChildren.length > 0 ? nextParagraphChildren : null,
    }),
    ...childArray.slice(1),
  ].filter((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return true
    return child.props.children !== null
  })

  return { type, title, defaultOpen, children: nextChildren }
}

function encodeCalloutPayload(payload: { type: string; title: string; fold: string }) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
}

function decodeCalloutPayload(encoded: string) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(encoded)))) as { type: string; title: string; fold: string }
  } catch {
    return { type: "note", title: "Note", fold: "" }
  }
}

function stripBlockquoteMarker(line: string) {
  return line.replace(/^\s*> ?/, "")
}

export function preprocessObsidianCallouts(content: string) {
  const lines = content.split(/\r?\n/)
  const output: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const markerMatch = /^\s*> ?\[!([^\]]+)\]([+-])?\s*(.*)$/.exec(line)
    if (!markerMatch) {
      output.push(line)
      continue
    }

    const type = markerMatch[1].trim()
    const fold = markerMatch[2] ?? ""
    const title = markerMatch[3].trim() || (calloutMeta[type.toLowerCase()]?.label ? t(calloutMeta[type.toLowerCase()].label) : "") || type
    const bodyLines: string[] = []
    index += 1
    while (index < lines.length) {
      const nextLine = lines[index]
      if (!/^\s*>/.test(nextLine)) {
        index -= 1
        break
      }
      bodyLines.push(stripBlockquoteMarker(nextLine))
      index += 1
    }
    output.push(`[[AILS_CALLOUT:${encodeCalloutPayload({ type, title, fold })}]]`)
    output.push(bodyLines.join("\n").trim())
    output.push("[[/AILS_CALLOUT]]")
  }
  return output.join("\n")
}

export function preprocessLooseLatexBlocks(content: string) {
  const lines = content.split(/\r?\n/)
  const output: string[] = []
  let inFence = false

  function looseLatexExpression(line: string) {
    const trimmed = line.trim()
    if (!trimmed || !looseLatexCommandPattern.test(trimmed)) return null
    const orphanClosingMatch = /^(.*?)(\s*)\$\$(\s*(?:---)?\s*)$/.exec(trimmed)
    if (orphanClosingMatch && !orphanClosingMatch[1].includes("$$")) {
      return {
        expression: orphanClosingMatch[1].trim(),
        suffix: orphanClosingMatch[3].trim(),
      }
    }
    if (!trimmed.includes("$") && !trimmed.includes("\\(") && !trimmed.includes("\\[")) {
      return { expression: trimmed, suffix: "" }
    }
    return null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      output.push(line)
      continue
    }

    if (inFence) {
      output.push(line)
      continue
    }

    const trimmedLine = line.trim()
    if (trimmedLine.startsWith("$$")) {
      const expressions: string[] = []
      const suffixes: string[] = []
      const firstBody = trimmedLine.slice(2).trim()
      let cursor = index

      if (firstBody.includes("$$")) {
        const [body, suffix = ""] = firstBody.split("$$", 2)
        if (body.trim()) expressions.push(body.trim())
        if (suffix.trim()) suffixes.push(suffix.trim())
      } else {
        if (firstBody) expressions.push(firstBody)
        cursor = index + 1
        while (cursor < lines.length) {
          const nextLine = lines[cursor].trim()
          if (nextLine.includes("$$")) {
            const [body, suffix = ""] = nextLine.split("$$", 2)
            if (body.trim()) expressions.push(body.trim())
            if (suffix.trim()) suffixes.push(suffix.trim())
            break
          }
          expressions.push(lines[cursor])
          cursor += 1
        }
      }

      output.push("$$")
      output.push(expressions.join("\n").trim())
      output.push("$$")
      output.push(...suffixes)
      index = cursor
      continue
    }

    const firstExpression = looseLatexExpression(line)
    if (!firstExpression) {
      if (/^\s*[−-]{3,}\s*$/.test(line)) {
        output.push("---")
        continue
      }
      output.push(line)
      continue
    }

    const expressions = [firstExpression.expression]
    const suffixes = firstExpression.suffix ? [firstExpression.suffix] : []
    let cursor = index + 1
    while (cursor < lines.length) {
      const nextLine = lines[cursor]
      if (/^\s*$/.test(nextLine)) {
        cursor += 1
        continue
      }
      if (/^\s*```/.test(nextLine)) {
        break
      }
      const nextExpression = looseLatexExpression(nextLine)
      if (!nextExpression) {
        break
      }
      expressions.push(nextExpression.expression)
      if (nextExpression.suffix) {
        suffixes.push(nextExpression.suffix)
      }
      cursor += 1
    }

    output.push("$$")
    output.push(expressions.join("\n"))
    output.push("$$")
    output.push(...suffixes)
    index = cursor - 1
  }

  return output.join("\n")
}

export function renderCalloutSegments(content: string, renderMarkdown: (content: string, key: string) => ReactNode) {
  const segments: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  encodedCalloutPattern.lastIndex = 0
  while ((match = encodedCalloutPattern.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index)
    if (before.trim()) {
      segments.push(renderMarkdown(before, `md-${segments.length}`))
    }
    const payload = decodeCalloutPayload(match[1])
    const type = payload.type.toLowerCase()
    const title = payload.title || (calloutMeta[type]?.label ? t(calloutMeta[type].label) : "") || payload.type
    const defaultOpen = payload.fold !== "-"
    const body = match[2].trim()
    segments.push(
      <CalloutBlock defaultOpen={defaultOpen} key={`callout-${segments.length}`} title={title} className={(calloutMeta[type] ?? calloutMeta.note).className}>
        {renderMarkdown(body, `callout-body-${segments.length}`)}
      </CalloutBlock>,
    )
    lastIndex = match.index + match[0].length
  }
  const rest = content.slice(lastIndex)
  if (rest.trim() || segments.length === 0) {
    segments.push(renderMarkdown(rest, `md-${segments.length}`))
  }
  return segments
}

export function createMarkdownComponents(
  onOpenLocalMarkdown?: (href: string, event?: ReactMouseEvent<HTMLElement>) => void,
  onHighlightContextMenu?: (text: string, event: ReactMouseEvent<HTMLElement>) => void,
  onImageDoubleClick?: (src: string, alt: string) => void,
): Components {
  return {
    blockquote({ children, ...props }) {
      const callout = parseCallout(children)
      if (!callout) {
        return <blockquote {...markdownAnchorAttributes(props)}>{children}</blockquote>
      }

      return (
        <CalloutBlock defaultOpen={callout.defaultOpen} title={callout.title} className={(calloutMeta[callout.type] ?? calloutMeta.note).className}>
          {callout.children}
        </CalloutBlock>
      )
    },
    a({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
      const value = String(href ?? "")
      const isLocalMarkdown =
        value.toLowerCase().endsWith(".md") ||
        value.toLowerCase().includes(".md#") ||
        value.toLowerCase().includes(".md?")
      if (isLocalMarkdown) {
        return (
          <button
            className="font-medium text-[var(--brand)] underline underline-offset-4 hover:opacity-80"
            onClick={(event) => onOpenLocalMarkdown?.(value, event)}
            onAuxClick={(event) => {
              if (event.button !== 1) return
              event.preventDefault()
              onOpenLocalMarkdown?.(value, event)
            }}
            onMouseDown={(event) => {
              // 휠 클릭의 Chromium 자동 스크롤을 막는다.
              if (event.button === 1) event.preventDefault()
            }}
            type="button"
          >
            {children}
          </button>
        )
      }
      return (
        <a href={href} rel="noreferrer" target={value.startsWith("http") ? "_blank" : undefined} {...props}>
          {children}
        </a>
      )
    },
    img({ alt, src, ...props }) {
      const altText = String(alt ?? "")
      const sizeMatch = /^(.*)\|(\d{2,4})(?:x(\d{2,4}))?$/.exec(altText)
      const displayAlt = sizeMatch ? sizeMatch[1] : altText
      const width = sizeMatch ? Number(sizeMatch[2]) : undefined
      const height = sizeMatch?.[3] ? Number(sizeMatch[3]) : undefined

      return (
        <MarkdownImage
          alt={displayAlt}
          className="rounded-lg border border-[var(--border)] cursor-pointer select-none"
          height={height}
          loading="lazy"
          src={src}
          width={width}
          onDoubleClick={() => onImageDoubleClick?.(src || "", altText)}
          {...props}
        />
      )
    },
    pre({ children, ...props }) {
      const highlighted = Children.toArray(children).some(
        (child) => isValidElement<{ className?: string }>(child) && /language-(\w+)/.test(child.props.className ?? ""),
      )
      return (
        <pre
          {...markdownAnchorAttributes(props)}
          style={highlighted ? undefined : { backgroundColor: "#000", color: "#fff", padding: "1rem", borderRadius: "0.75rem" }}
        >
          {children}
        </pre>
      )
    },
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className ?? "")

      if (match) {
        return (
          <DeferredCodeHighlight
            {...markdownAnchorAttributes(props)}
            customStyle={{
              borderRadius: "0.75rem",
              fontSize: "0.86rem",
              margin: "1rem 0",
              padding: "1rem",
            }}
            language={match[1]}
          >
            {String(children).replace(/\n$/, "")}
          </DeferredCodeHighlight>
        )
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    },
    p({ children, ...props }) {
      return <p {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</p>
    },
    li({ children, ...props }) {
      return <li {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</li>
    },
    td({ children, ...props }) {
      return <td {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</td>
    },
    th({ children, ...props }) {
      return <th {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</th>
    },
    strong({ children }) {
      return <strong>{processHighlights(children, onHighlightContextMenu)}</strong>
    },
    em({ children }) {
      return <em>{processHighlights(children, onHighlightContextMenu)}</em>
    },
    h1({ children, ...props }) {
      return <h1 {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</h1>
    },
    h2({ children, ...props }) {
      return <h2 {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</h2>
    },
    h3({ children, ...props }) {
      return <h3 {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</h3>
    },
    h4({ children, ...props }) {
      return <h4 {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</h4>
    },
    h5({ children, ...props }) {
      return <h5 {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</h5>
    },
    h6({ children, ...props }) {
      return <h6 {...markdownAnchorAttributes(props)}>{processHighlights(children, onHighlightContextMenu)}</h6>
    },
  }
}
