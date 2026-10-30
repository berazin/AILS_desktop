import { MarkdownViewer } from '../../../shared/components/markdown-viewer.tsx'
import { useLayoutEffect } from 'react'
import { markChatLatency } from '../lib/chat-latency.ts'

export function ChatAnswerMarkdown({ content, timingId }: { content: string; timingId?: string }) {
  useLayoutEffect(() => {
    if (timingId && content) markChatLatency(timingId, 'first_ui_commit')
  }, [timingId, content])
  return <MarkdownViewer content={content} enableLooseLatexRepair
    className="prose-code:before:content-none prose-code:after:content-none" />
}
