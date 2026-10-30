import { useEffect, useRef } from "react"
import { chatDocumentKey, viewerDocumentIsPdf, type ViewerDocument } from "../../../lib/viewer-document.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

import { waitForInitialDocument } from '../../../lib/initial-document-readiness.ts'
import {
  deletePdfStudyChatHistory,
  getPdfStudyChatHistory,
  getPdfStudyChatSessions,
} from "../../../lib/api"
import {
  chatbotAnswerForDisplay,
  chatbotAnswerTitle,
  chatbotQuestionForDisplay,
  chatSessionMessageKey,
} from "../../../lib/chatbot-display.ts"
import { t } from "../../../lib/i18n.ts"
import type { ChatController, ChatMessage } from "./use-chat-controller.ts"

const EMPTY_CHAT_MESSAGES: ChatMessage[] = []

type UseChatSessionWorkflowsOptions = {
  chat: ChatController
  document: {
    isPdf: boolean
    key: string
    pdfPath: string
    openDocuments: ViewerDocument[]
  }
  onNotice: (message: string) => void
  runInteraction: (
    key: string,
    label: string,
    action: () => Promise<string | void>,
    onError?: (error: unknown) => void,
  ) => Promise<void>
}

export function useChatSessionWorkflows({
  chat,
  document,
  onNotice,
  runInteraction,
}: UseChatSessionWorkflowsOptions) {
  const {
    input: { chatInputDraftRef, chatInputRef, pdfQuickChatInputRef, setChatInputDraft },
    messages: { chatMessagesByDocument, setChatMessagesByDocument, setMessagesForKey },
    pdf: {
      activePdfChatSessionByDocument,
      pdfChatContextRef,
      pdfChatSessionsOpen,
      setActivePdfChatSessionByDocument,
      setPdfChatHistoryDeleteConfirm,
      setPdfChatSessions,
      setPdfChatSessionsOpen,
      setPdfQuickChatOpen,
    },
  } = chat
  const previousPdfKeys = useRef(new Set<string>())
  useEffect(() => {
    const opened = new Set(document.openDocuments.filter(viewerDocumentIsPdf).map(chatDocumentKey))
    const closed = [...previousPdfKeys.current].filter(key => !opened.has(key))
    previousPdfKeys.current = opened
    if (!closed.length) return
    // Forget only the selection. Saved sessions and their messages remain
    // available through History; switching between open tabs keeps the selection.
    setActivePdfChatSessionByDocument(current => {
      const next = { ...current }
      for (const key of closed) delete next[key]
      return next
    })
  }, [document.openDocuments, setActivePdfChatSessionByDocument])

  const createSession = useEventCallback((onlyIfMissing = false) => {
    if (!document.isPdf || !document.pdfPath) return
    if (onlyIfMissing && activePdfChatSessionByDocument[document.key]) return
    const sessionId = crypto.randomUUID()
    setMessagesForKey(chatSessionMessageKey(document.key, sessionId), () => [])
    setActivePdfChatSessionByDocument(current => ({ ...current, [document.key]: sessionId }))
    chatInputDraftRef.current = ""
    setChatInputDraft("")
    if (chatInputRef.current) chatInputRef.current.value = ""
    if (pdfQuickChatInputRef.current) pdfQuickChatInputRef.current.value = ""
    pdfChatContextRef.current = null
    chat.assist.setRetrievalStateByDocument(current => {
      const next = { ...current }
      delete next[document.pdfPath]
      return next
    })
  })
  const activePdfSessionId = document.isPdf
    ? activePdfChatSessionByDocument[document.key] ?? ""
    : ""
  const activeMessageKey = chatSessionMessageKey(document.key, activePdfSessionId)
  const messages = chatMessagesByDocument[activeMessageKey] ?? EMPTY_CHAT_MESSAGES
  let latestAssistantMessageId = ""
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      latestAssistantMessageId = messages[index].id
      break
    }
  }

  useEffect(() => {
    pdfChatContextRef.current = null
    setPdfQuickChatOpen(false)
    setPdfChatHistoryDeleteConfirm(false)
    setPdfChatSessionsOpen(false)
    setPdfChatSessions([])
    if (!document.isPdf || !document.pdfPath) return undefined
    createSession(true)
    const controller = new AbortController()
    void waitForInitialDocument(controller.signal).then(() => getPdfStudyChatSessions(document.pdfPath, controller.signal)).then(({ sessions }) => {
      if (controller.signal.aborted) return
      setPdfChatSessions(sessions)
    }).catch((error) => {
      if (!controller.signal.aborted) console.warn("[PDF chat sessions] load failed", error)
    })
    return () => controller.abort()
  }, [
    document.isPdf,
    document.key,
    document.pdfPath,
    createSession,
    pdfChatContextRef,
    setActivePdfChatSessionByDocument,
    setPdfChatHistoryDeleteConfirm,
    setPdfChatSessions,
    setPdfChatSessionsOpen,
    setPdfQuickChatOpen,
  ])

  useEffect(() => {
    if (!document.isPdf || !document.pdfPath || !activePdfSessionId) return undefined
    // New sessions start empty. Fetch persisted messages only when a history
    // session is explicitly selected and is not already resident in this window.
    if (Object.hasOwn(chat.messages.chatMessagesByDocumentRef.current, activeMessageKey)) return undefined
    const controller = new AbortController()
    const messageKey = activeMessageKey
    void getPdfStudyChatHistory(document.pdfPath, activePdfSessionId, controller.signal).then((history) => {
      if (controller.signal.aborted) return
      const loadedMessages = history.turns.flatMap((turn) => [
        { id: `${turn.turn_id}-user`, role: "user" as const, content: chatbotQuestionForDisplay(turn.question), practiceContext: turn.practice_context },
        {
          id: `${turn.turn_id}-assistant`,
          role: "assistant" as const,
          content: chatbotAnswerForDisplay(turn.answer),
          evidence: turn.answer_evidence,
          webSearch: turn.web_search,
          practiceContext: turn.practice_context,
          title: chatbotAnswerTitle(chatbotQuestionForDisplay(turn.question)),
        },
      ])
      setChatMessagesByDocument((current) => {
        const loadedIds = new Set(loadedMessages.map((message) => message.id))
        const pending = (current[messageKey] ?? []).filter((message) => !loadedIds.has(message.id))
        return { ...current, [messageKey]: [...loadedMessages, ...pending] }
      })
    }).catch((error) => {
      if (!controller.signal.aborted) console.warn("[PDF chat history] load failed", error)
    })
    return () => controller.abort()
  }, [
    activeMessageKey,
    activePdfSessionId,
    document.isPdf,
    document.pdfPath,
    setChatMessagesByDocument,
    chat.messages.chatMessagesByDocumentRef,
  ])

  function startNewSession() {
    if (!document.pdfPath || !document.isPdf) return
    createSession()
    setPdfChatSessionsOpen(false)
    setPdfChatHistoryDeleteConfirm(false)
  }

  async function openSessions() {
    if (!document.pdfPath) return
    const opening = !pdfChatSessionsOpen
    setPdfChatSessionsOpen(opening)
    if (!opening) return
    try {
      setPdfChatSessions((await getPdfStudyChatSessions(document.pdfPath)).sessions)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error))
    }
  }

  async function clearHistory() {
    if (!document.pdfPath || !activePdfSessionId) return
    await runInteraction("pdf-chat-history-clear", t("PDF 대화 기록 삭제"), async () => {
      const result = await deletePdfStudyChatHistory(document.pdfPath, activePdfSessionId)
      setMessagesForKey(activeMessageKey, () => [])
      setPdfChatSessions((current) => current.filter((session) => session.session_id !== activePdfSessionId))
      // Deleting a previous document's history must not reset a newly selected PDF.
      const nextSessionId = crypto.randomUUID()
      setMessagesForKey(chatSessionMessageKey(document.key, nextSessionId), () => [])
      setActivePdfChatSessionByDocument((current) => current[document.key] === activePdfSessionId
        ? { ...current, [document.key]: nextSessionId } : current)
      setPdfChatHistoryDeleteConfirm(false)
      return t("현재 대화 {p0}개를 삭제했습니다.", { p0: result.deleted_count })
    })
  }

  return {
    activeMessageKey,
    activePdfSessionId,
    clearHistory,
    latestAssistantMessageId,
    messages,
    openSessions,
    startNewSession,
  }
}
