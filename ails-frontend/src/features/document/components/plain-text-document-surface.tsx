import { useEffect, useRef } from 'react'
import type { ViewerDocument } from '../../../lib/viewer-document.ts'
import { observeDocumentPresentation } from '../../../lib/document-presentation-diagnostics.ts'

export function PlainTextDocumentSurface({ document }: { document: ViewerDocument }) {
  const root = useRef<HTMLPreElement>(null)
  useEffect(() => observeDocumentPresentation('txt', () => root.current), [document.id])
  return <pre ref={root} className="min-h-6 whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 select-text">{document.content}</pre>
}
