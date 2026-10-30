import type { ComponentProps } from "react"

import type { ChatVoiceWorkspace } from "../types/chat-workspace.ts"
import { ChatbotWorkspace } from "./chatbot-workspace.tsx"

type ChatbotWorkspaceProps = ComponentProps<typeof ChatbotWorkspace>

type ChatWorkspaceViewProps = {
  busy: ChatbotWorkspaceProps["busy"]
  controller: ChatVoiceWorkspace
  mode: ChatbotWorkspaceProps["mode"]
  showComposer?: boolean
  models: ChatbotWorkspaceProps["models"]
  onOpenMaterialFile: ChatbotWorkspaceProps["actions"]["onOpenMaterialFile"]
  workspace: ChatbotWorkspaceProps["workspace"]
  integration?: Pick<ChatbotWorkspaceProps, "embeddedHeader" | "composerContext" | "composerControls"> & {
    onAsk?: ChatbotWorkspaceProps["actions"]["onAsk"]
  }
}

export function ChatWorkspaceView({
  busy,
  controller,
  mode,
  showComposer,
  models,
  onOpenMaterialFile,
  workspace,
  integration,
}: ChatWorkspaceViewProps) {
  const sessions = controller.sessions
  const chatWindow = controller.window
  const voice = controller.voice

  return (
    <ChatbotWorkspace
      actions={{
        closeWindow: chatWindow.close,
        commitDraft: controller.draft.commit,
        handleAnswerDragEnd: chatWindow.handleAnswerDragEnd,
        handleAnswerDragStart: chatWindow.handleAnswerDragStart,
        handleAnswerPointerDown: chatWindow.handleAnswerPointerDown,
        onAgentModelChange: controller.requests.changeAgentModel,
        onAsk: integration?.onAsk ?? controller.requests.askChatbot,
        onStop: controller.requests.stopAnswer,
        onClearPdfHistory: sessions.clearHistory,
        onOpenMaterialFile,
        onOpenPdfSessions: sessions.openSessions,
        onStartVoice: controller.voiceSession.start,
        openWindow: chatWindow.open,
        startNewPdfSession: sessions.startNewSession,
      }}
      busy={busy}
      chat={controller.chat}
      document={{
        activeChatDocumentKey: controller.activeChatDocumentKey,
        activeChatMessageKey: sessions.activeMessageKey,
        activePdfChatSessionId: sessions.activePdfSessionId,
        chatMessages: sessions.messages,
        chatViewerDocument: controller.chatViewerDocument,
      }}
      mode={mode}
      embeddedHeader={integration?.embeddedHeader}
      composerContext={integration?.composerContext}
      composerControls={integration?.composerControls}
      showComposer={showComposer}
      models={models}
      voice={{
        onStart: controller.voiceSession.start,
        state: voice.state.voiceState,
        statusText: voice.state.voiceStatusText,
      }}
      workspace={workspace}
    />
  )
}
