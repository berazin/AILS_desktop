import { History, X } from "lucide-react"
import { practiceTutorLabel } from "../../../lib/api/practice-tutor.ts"
import type { ChatVoiceWorkspace } from "../../chat/types/chat-workspace.ts"
import { usePracticeTutor } from "../practice-tutor-provider.tsx"

export function PracticeTutorChatHeader({ controller, busy }: {
  controller: ChatVoiceWorkspace; busy: (key: string) => boolean
}) {
  const tutor = usePracticeTutor()
  const context = tutor?.context
  return <header data-practice-tutor-header>
    <div><strong className="text-sm">AI 튜터</strong><span className="min-w-0 flex-1 truncate text-[10px] text-[var(--muted-foreground)]" title={context?.source_path}>{context ? practiceTutorLabel(context) : "문제를 선택하세요"}</span>
      <button type="button" aria-label="튜터 대화 목록" disabled={busy("chatbot-ask")} onClick={() => void controller.sessions.openSessions()} className="rounded p-1.5 hover:bg-[var(--muted)]"><History size={14} /></button>
      <button type="button" aria-label="AI 튜터 닫기" onClick={tutor?.close} className="rounded p-1.5 hover:bg-[var(--muted)]"><X size={16} /></button>
    </div>
  </header>
}
