import { useEffect, useRef } from "react"
import type { AILSConfig, ModelOptionsPayload } from "../../../lib/api"
import type { PracticeTutorContext } from "../../../lib/api/practice-tutor.ts"
import type { ChatVoiceWorkspace } from "../../chat/types/chat-workspace.ts"
import { PracticeTutorChatHeader } from "../components/practice-tutor-chat-header.tsx"
import { PracticeTutorComposerControls } from "../components/practice-tutor-composer-controls.tsx"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { usePracticeTutor } from "../practice-tutor-provider.tsx"

export function usePracticeTutorChat(enabled: boolean, controller: ChatVoiceWorkspace,
  models: { config: AILSConfig; options: ModelOptionsPayload | null }, busy: (key: string) => boolean, onNotice: (message: string) => void) {
  const tutor = usePracticeTutor()
  const handled = useRef("")
  const context = tutor?.context
  const draft = tutor?.draftRequest
  const { chatInputDraftRef, chatInputRef } = controller.chat.input
  const commit = useEventCallback(controller.draft.commit)
  useEffect(() => {
    if (!enabled || !draft || handled.current === draft.id) return
    handled.current = draft.id
    commit(draft.text)
    requestAnimationFrame(() => chatInputRef.current?.focus())
  }, [enabled, draft, commit, chatInputRef])
  if (!enabled || !tutor) return null
  return {
    ask: (question?: string, display?: string, options?: { forceCloud?: boolean; practiceContext?: PracticeTutorContext }) => controller.requests.askChatbot(
      question ?? chatInputDraftRef.current, display,
      { ...options, practiceContext: options?.practiceContext ?? tutor.snapshot() ?? undefined }),
    header: <PracticeTutorChatHeader controller={controller} busy={busy} />,
    composerControls: <PracticeTutorComposerControls controller={controller} models={models} busy={busy} onNotice={onNotice} />,
    contextControl: <label className="mb-2 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
      <input type="checkbox" checked={tutor.includeContext} onChange={event => tutor.setIncludeContext(event.target.checked)} />현재 문제 문맥 포함
      <span className="ml-auto">{!tutor.includeContext ? "문제 문맥 제외" : context?.phase === "graded" ? "공개된 채점 결과 포함" : "정답·해설 제외"}</span>
    </label>,
  }
}
