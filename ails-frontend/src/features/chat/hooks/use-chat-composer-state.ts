import { useRef,useState } from "react"

export function useChatComposerState({ initialDraft="" }: { initialDraft?: string }={}) {
  const [chatInputDraft,setChatInputDraft]=useState(initialDraft)
  const [chatReasoningEffort,setChatReasoningEffort]=useState("default")
  const chatInputDraftRef=useRef(chatInputDraft)
  const chatInputRef=useRef<HTMLTextAreaElement|null>(null)
  const pdfQuickChatInputRef=useRef<HTMLTextAreaElement|null>(null)
  const chatSelectedTextContextRef=useRef<{ documentKey: string; text: string }|null>(null)
  return {
    input: {
      chatInputDraft,
      chatInputDraftRef,
      chatInputRef,
      pdfQuickChatInputRef,
      setChatInputDraft,
      chatReasoningEffort,
      setChatReasoningEffort,
    },
    selection: {
      chatSelectedTextContextRef,
    }
  }
}
