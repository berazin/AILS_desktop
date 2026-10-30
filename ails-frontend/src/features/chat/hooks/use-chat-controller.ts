import {
  askChatbotExpert,
  askChatbotStream,
  deletePdfStudyChatHistory,
  deletePdfStudyChatTurn,
  getAiAssistStatus,
  getPdfStudyChatHistory,
  getPdfStudyChatSessions,
  mergeChatbotUsageTotals,
  saveChatbotAnswer,
  savePdfStudyChatTurn,
  searchContext,
  stopAiAssist,
  warmupAiAssist,
} from "../../../lib/api"
import { useChatMessages } from "./use-chat-messages.ts"
import { useChatComposerState } from "./use-chat-composer-state.ts"
import { useChatPresentationState } from "./use-chat-presentation-state.ts"
import { useChatStudyState } from "./use-chat-study-state.ts"
import { useChatAssistState } from "./use-chat-assist-state.ts"

export type { ChatActivity,ChatMessage,ChatMessagesByDocument } from "../lib/chat-types.ts"

type UseChatControllerOptions={ initialDraft?: string; initialOpen?: boolean }

export function useChatController({ initialDraft="",initialOpen=false }: UseChatControllerOptions={}) {
  const composer=useChatComposerState({ initialDraft })
  const presentation=useChatPresentationState({ initialOpen })
  const study=useChatStudyState()
  const assist=useChatAssistState()
  const messages=useChatMessages()
  return {
    api: {
      askChatbotExpert,
      askChatbotStream,
      deletePdfStudyChatHistory,
      deletePdfStudyChatTurn,
      getAiAssistStatus,
      getPdfStudyChatHistory,
      getPdfStudyChatSessions,
      mergeChatbotUsageTotals,
      saveChatbotAnswer,
      savePdfStudyChatTurn,
      searchContext,
      stopAiAssist,
      warmupAiAssist,
    },...composer,...presentation,...study,...assist,messages
  }
}

export type ChatController=ReturnType<typeof useChatController>
