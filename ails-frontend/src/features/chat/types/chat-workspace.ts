import type { ViewerDocument } from '../../../lib/viewer-document.ts'
import type { ChatController } from '../hooks/use-chat-controller.ts'
import type { useChatAnswerWorkflows } from '../hooks/use-chat-answer-workflows.ts'
import type { useChatRequestWorkflows } from '../hooks/use-chat-request-workflows.ts'
import type { useChatSessionWorkflows } from '../hooks/use-chat-session-workflows.ts'
import type { useChatWindowWorkflows } from '../hooks/use-chat-window-workflows.ts'
import type { VoiceController } from '../../voice/hooks/use-voice-controller.ts'
import type { useVoiceSessionWorkflows } from '../../voice/hooks/use-voice-session-workflows.ts'

/** View contract owned by chat; application composition supplies its workflows. */
export type ChatVoiceWorkspace = {
  activeChatDocumentKey: string
  reasoningAvailable: boolean
  chat: ChatController
  chatViewerDocument: ViewerDocument | null
  answers: ReturnType<typeof useChatAnswerWorkflows>
  draft: { commit(value: string): void; onChange(value: string): void }
  requests: ReturnType<typeof useChatRequestWorkflows>
  sessions: ReturnType<typeof useChatSessionWorkflows>
  voice: VoiceController
  voiceSession: ReturnType<typeof useVoiceSessionWorkflows>
  window: ReturnType<typeof useChatWindowWorkflows>
}
