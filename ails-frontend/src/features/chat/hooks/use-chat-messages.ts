import { useCallback, useRef, useState, type SetStateAction } from "react"
import type { ChatMessage, ChatMessagesByDocument } from "../lib/chat-types.ts"

/** The request replacing a stream must see its last token before React paints. */
export function useChatMessages() {
  const [chatMessagesByDocument, setState] = useState<ChatMessagesByDocument>({})
  const chatMessagesByDocumentRef = useRef(chatMessagesByDocument)
  const setChatMessagesByDocument = useCallback((update: SetStateAction<ChatMessagesByDocument>) => {
    const next = typeof update === "function" ? update(chatMessagesByDocumentRef.current) : update
    chatMessagesByDocumentRef.current = next
    setState(next)
  }, [])
  const setMessagesForKey = useCallback((key: string, update: (current: ChatMessage[]) => ChatMessage[]) => {
    setChatMessagesByDocument(current => ({ ...current, [key]: update(current[key] ?? []) }))
  }, [setChatMessagesByDocument])
  const replaceMessage = useCallback((id: string, content: string, key: string) => {
    setMessagesForKey(key, current => current.map(message => message.id === id ? { ...message, content } : message))
  }, [setMessagesForKey])
  const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>, key: string) => {
    setMessagesForKey(key, current => current.map(message => message.id === id ? { ...message, ...patch } : message))
  }, [setMessagesForKey])
  const idCounterRef = useRef(0)
  const nextChatId = useCallback((prefix: string) => {
    idCounterRef.current += 1
    return `${idCounterRef.current}-${prefix}`
  }, [])
  return { nextChatId, chatMessagesByDocument, chatMessagesByDocumentRef, setChatMessagesByDocument, setMessagesForKey, replaceMessage, updateMessage }
}
