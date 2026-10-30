import { useRef,useState } from "react"
import type { ChatMessage } from "../lib/chat-types.ts"

export function useChatPresentationState({ initialOpen=false }: { initialOpen?: boolean }={}) {
  const [chatbotAgentModelOpen,setChatbotAgentModelOpen]=useState(false)
  const chatbotAgentModelPickerRef=useRef<HTMLDivElement|null>(null)
  const [chatbotWindowOpen,setChatbotWindowOpen]=useState(initialOpen)
  const [chatbotAnswerWindowOpen,setChatbotAnswerWindowOpen]=useState(false)
  const [selectedChatbotAnswer,setSelectedChatbotAnswer]=useState<ChatMessage|null>(null)
  const [chatbotWindowScrollMode,setChatbotWindowScrollMode]=useState<"restore"|"bottom"|null>(null)
  const [draggedChatAnswerId,setDraggedChatAnswerId]=useState("")
  const [droppedAnswerLinks,setDroppedAnswerLinks]=useState<Array<{ id: string; title: string; link: string }>>([])
  const [dropPreview,setDropPreview]=useState<{ top: number; lineIndex?: number; message: string }|null>(null)
  const chatbotWindowScrollRef=useRef<HTMLDivElement|null>(null)
  const chatbotWindowScrollTopByDocumentRef=useRef<Record<string,number>>({})
  const chatbotWindowSeenAnswerIdByDocumentRef=useRef<Record<string,string>>({})
  const shouldFocusChatbotInputRef=useRef(false)
  return {
    agentModel: {
      chatbotAgentModelOpen,
      chatbotAgentModelPickerRef,
      setChatbotAgentModelOpen,
    },
    drag: {
      draggedChatAnswerId,
      dropPreview,
      droppedAnswerLinks,
      setDraggedChatAnswerId,
      setDropPreview,
      setDroppedAnswerLinks,
    },
    window: {
      chatbotAnswerWindowOpen,
      chatbotWindowOpen,
      chatbotWindowScrollMode,
      chatbotWindowScrollRef,
      chatbotWindowScrollTopByDocumentRef,
      chatbotWindowSeenAnswerIdByDocumentRef,
      selectedChatbotAnswer,
      setChatbotAnswerWindowOpen,
      setChatbotWindowOpen,
      setChatbotWindowScrollMode,
      setSelectedChatbotAnswer,
      shouldFocusChatbotInputRef,
    }
  }
}
