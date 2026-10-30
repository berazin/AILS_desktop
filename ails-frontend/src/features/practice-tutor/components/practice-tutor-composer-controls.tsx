import type { AILSConfig, ModelOptionsPayload } from "../../../lib/api"
import type { ChatVoiceWorkspace } from "../../chat/types/chat-workspace.ts"
import { ChatComposerControls } from "../../chat/components/chat-composer-controls.tsx"
import { ChatGPTPlanIndicatorForConfig } from "../../chat/components/chatgpt-plan-indicator.tsx"

export function PracticeTutorComposerControls({ controller, models, busy, onNotice }: {
  controller: ChatVoiceWorkspace; models: { config: AILSConfig; options: ModelOptionsPayload | null }
  busy: (key: string) => boolean; onNotice: (message: string) => void
}) {
  return <div data-practice-tutor-composer-controls className="mb-2 min-w-0">
    <ChatGPTPlanIndicatorForConfig config={models.config} busy={busy("chatbot-ask")} onError={onNotice} />
    <ChatComposerControls modelFirst config={models.config} options={models.options}
      reasoning={controller.chat.input.chatReasoningEffort} onReasoningChange={controller.chat.input.setChatReasoningEffort}
      onModelChange={id => controller.requests.changeAgentModel(id, { requireTools: false })}
      busy={busy("chatbot-ask")} savingModel={busy("chatbot-agent-model-save")} reasoningDisabled={!controller.reasoningAvailable} />
  </div>
}
