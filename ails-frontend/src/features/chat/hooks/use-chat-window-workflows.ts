import {
  useEffect,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react"

import { t } from "../../../lib/i18n.ts"
import { estimateDropLineIndex, estimateDropTop } from "../../../lib/viewer-editing.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import type { ChatController, ChatMessage } from "./use-chat-controller.ts"

type UseChatWindowWorkflowsOptions = {
  activeMessageKey: string
  chat: ChatController
  chatbotVisible: boolean
  codeSandboxKeyboardCaptured: boolean
  latestAssistantMessageId: string
  messages: ChatMessage[]
  onDropAnswer: (answer: ChatMessage, lineIndex?: number) => Promise<void>
  setNotice: Dispatch<SetStateAction<string>>
  textEntryActiveRef: RefObject<boolean>
  viewerDocument: ViewerDocument | null
}

export function useChatWindowWorkflows({
  activeMessageKey,
  chat,
  chatbotVisible,
  codeSandboxKeyboardCaptured,
  latestAssistantMessageId,
  messages,
  onDropAnswer,
  setNotice,
  textEntryActiveRef,
  viewerDocument,
}: UseChatWindowWorkflowsOptions) {
  const {
    drag: { setDraggedChatAnswerId, setDropPreview },
    input: { chatInputRef, pdfQuickChatInputRef },
    window: {
      chatbotWindowOpen,
      chatbotWindowScrollMode,
      chatbotWindowScrollRef,
      chatbotWindowScrollTopByDocumentRef,
      chatbotWindowSeenAnswerIdByDocumentRef,
      setChatbotWindowOpen,
      setChatbotWindowScrollMode,
      shouldFocusChatbotInputRef,
    },
  } = chat

  useEffect(() => {
    if (!chatbotVisible || !latestAssistantMessageId) return
    if (chatbotWindowSeenAnswerIdByDocumentRef.current[activeMessageKey] === latestAssistantMessageId) return
    chatbotWindowSeenAnswerIdByDocumentRef.current[activeMessageKey] = latestAssistantMessageId
    // The visible workspace follows only while the reader stays at the bottom.
    // Explicit open/send actions still request a bottom jump or saved-position restore.
  }, [
    activeMessageKey,
    chatbotVisible,
    chatbotWindowSeenAnswerIdByDocumentRef,
    latestAssistantMessageId,
  ])

  useEffect(() => {
    if (!chatbotVisible || !chatbotWindowScrollMode) return undefined
    const frame = window.requestAnimationFrame(() => {
      const container = chatbotWindowScrollRef.current
      if (container) {
        container.scrollTop =
          chatbotWindowScrollMode === "bottom"
            ? container.scrollHeight
            : chatbotWindowScrollTopByDocumentRef.current[activeMessageKey] ?? 0
      }
      setChatbotWindowScrollMode(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    activeMessageKey,
    chatbotVisible,
    chatbotWindowScrollMode,
    chatbotWindowScrollRef,
    chatbotWindowScrollTopByDocumentRef,
    messages.length,
    setChatbotWindowScrollMode,
  ])

  useEffect(() => {
    if (!chatbotVisible || !shouldFocusChatbotInputRef.current) return undefined
    const frame = window.requestAnimationFrame(() => {
      shouldFocusChatbotInputRef.current = false
      const input = chatInputRef.current ?? pdfQuickChatInputRef.current
      input?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chatInputRef, chatbotVisible, pdfQuickChatInputRef, shouldFocusChatbotInputRef])

  useEffect(() => {
    const handleChatbotSpaceToggle = (event: globalThis.KeyboardEvent) => {
      const sandboxTarget =
        event.target instanceof HTMLElement && Boolean(event.target.closest("[data-ails-code-sandbox='true']"))
      const sandboxActive =
        document.activeElement instanceof HTMLElement &&
        Boolean(document.activeElement.closest("[data-ails-code-sandbox='true']"))
      if (codeSandboxKeyboardCaptured || sandboxTarget || sandboxActive) return
      if (event.code !== "Space" || !event.shiftKey || event.repeat || textEntryActiveRef.current) return
      event.preventDefault()
      if (chatbotWindowOpen) {
        chatbotWindowScrollTopByDocumentRef.current[activeMessageKey] =
          chatbotWindowScrollRef.current?.scrollTop
          ?? chatbotWindowScrollTopByDocumentRef.current[activeMessageKey]
          ?? 0
        if (latestAssistantMessageId) {
          chatbotWindowSeenAnswerIdByDocumentRef.current[activeMessageKey] = latestAssistantMessageId
        }
        setChatbotWindowOpen(false)
        setNotice(t("학습 챗봇을 닫았습니다."))
        return
      }

      const seenAnswerId = chatbotWindowSeenAnswerIdByDocumentRef.current[activeMessageKey] ?? ""
      const hasNewAnswer = Boolean(latestAssistantMessageId && latestAssistantMessageId !== seenAnswerId)
      setChatbotWindowScrollMode(hasNewAnswer ? "bottom" : "restore")
      if (hasNewAnswer) {
        chatbotWindowSeenAnswerIdByDocumentRef.current[activeMessageKey] = latestAssistantMessageId
      }
      shouldFocusChatbotInputRef.current = true
      setChatbotWindowOpen(true)
      setNotice(t("학습 챗봇을 열었습니다."))
    }

    const handleChatbotToggleEvent = () => {
      setChatbotWindowOpen((current) => {
        if (!current) {
          shouldFocusChatbotInputRef.current = true
          setChatbotWindowScrollMode("restore")
        }
        return !current
      })
    }

    window.addEventListener("keydown", handleChatbotSpaceToggle)
    window.addEventListener("ails-toggle-chatbot", handleChatbotToggleEvent)
    return () => {
      window.removeEventListener("keydown", handleChatbotSpaceToggle)
      window.removeEventListener("ails-toggle-chatbot", handleChatbotToggleEvent)
    }
  }, [
    activeMessageKey,
    chatbotWindowOpen,
    chatbotWindowScrollRef,
    chatbotWindowScrollTopByDocumentRef,
    chatbotWindowSeenAnswerIdByDocumentRef,
    codeSandboxKeyboardCaptured,
    latestAssistantMessageId,
    setChatbotWindowOpen,
    setChatbotWindowScrollMode,
    setNotice,
    shouldFocusChatbotInputRef,
    textEntryActiveRef,
  ])

  function open() {
    const seenAnswerId = chatbotWindowSeenAnswerIdByDocumentRef.current[activeMessageKey] ?? ""
    const hasNewAnswer = Boolean(latestAssistantMessageId && latestAssistantMessageId !== seenAnswerId)
    setChatbotWindowScrollMode(hasNewAnswer ? "bottom" : "restore")
    if (hasNewAnswer) {
      chatbotWindowSeenAnswerIdByDocumentRef.current[activeMessageKey] = latestAssistantMessageId
    }
    shouldFocusChatbotInputRef.current = true
    setChatbotWindowOpen(true)
    setNotice(t("학습 챗봇을 열었습니다."))
  }

  function close() {
    chatbotWindowScrollTopByDocumentRef.current[activeMessageKey] =
      chatbotWindowScrollRef.current?.scrollTop
      ?? chatbotWindowScrollTopByDocumentRef.current[activeMessageKey]
      ?? 0
    if (latestAssistantMessageId) {
      chatbotWindowSeenAnswerIdByDocumentRef.current[activeMessageKey] = latestAssistantMessageId
    }
    setChatbotWindowOpen(false)
    setNotice(t("학습 챗봇을 닫았습니다."))
  }

  function toggle() {
    if (chatbotWindowOpen) close()
    else open()
  }

  function restoreAfterAnswerDrag(handle?: HTMLElement) {
    if (handle) {
      delete handle.dataset.ailsChatAnswerDragPhase
      delete handle.dataset.ailsChatAnswerId
    }
  }

  function getActiveDraggedAnswerId() {
    const handle = document.querySelector<HTMLElement>("[data-ails-chat-answer-id]")
    return handle?.dataset.ailsChatAnswerId ?? ""
  }

  function getViewerDropZoneAt(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY)
    if (!(element instanceof HTMLElement)) return null
    return element.closest("[data-ails-viewer-drop-zone='true']") as HTMLElement | null
  }

  function updateDropPreview(clientX: number, clientY: number, dropZone: HTMLElement | null) {
    if (!dropZone || !viewerDocument) {
      setDropPreview(null)
      return
    }
    if (viewerDocument.kind === "md") {
      const nextTop = Math.round(estimateDropTop(clientY, dropZone) / 6) * 6
      const nextLineIndex = estimateDropLineIndex(viewerDocument.content, clientX, clientY, dropZone)
      setDropPreview((current) => {
        const nextMessage = t("여기에 답변 링크 삽입")
        if (current?.top === nextTop && current.lineIndex === nextLineIndex && current.message === nextMessage) {
          return current
        }
        return { top: nextTop, lineIndex: nextLineIndex, message: nextMessage }
      })
      return
    }
    const nextTop = Math.round(estimateDropTop(clientY, dropZone) / 6) * 6
    setDropPreview((current) => {
      const nextMessage = t("이 파일에는 링크를 삽입할 수 없습니다. 답변은 MD에만 저장할 수 있습니다.")
      if (current?.top === nextTop && current.message === nextMessage) return current
      return { top: nextTop, message: nextMessage }
    })
  }

  function handleAnswerDragStart(event: ReactDragEvent<HTMLElement>, message: ChatMessage) {
    if (message.role !== "assistant") return
    event.currentTarget.dataset.ailsChatAnswerDragPhase = "dragging"
    event.currentTarget.dataset.ailsChatAnswerId = message.id
    setDraggedChatAnswerId(message.id)
    event.dataTransfer.setData("application/x-ails-chat-answer", message.id)
    event.dataTransfer.setData("text/plain", message.id)
    event.dataTransfer.effectAllowed = "copy"
    setNotice(t("챗봇 답변 링크를 드래그하는 중입니다."))
  }

  function handleAnswerDragEnd(event: ReactDragEvent<HTMLElement>) {
    setDropPreview(null)
    restoreAfterAnswerDrag(event.currentTarget)
    window.setTimeout(() => {
      setDraggedChatAnswerId("")
    }, 0)
  }

  function handleAnswerPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    message: ChatMessage,
    mode: "inline" | "window",
  ) {
    if (mode !== "window" || message.role !== "assistant" || !chatbotWindowOpen) return

    event.preventDefault()
    event.stopPropagation()

    const handle = event.currentTarget
    handle.dataset.ailsChatAnswerDragPhase = "dragging"
    handle.dataset.ailsChatAnswerId = message.id
    setDraggedChatAnswerId(message.id)
    setNotice(t("답변을 정리본에 드롭하면 링크로 저장됩니다."))

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerCancel)
      restoreAfterAnswerDrag(handle)
      setDraggedChatAnswerId("")
      setDropPreview(null)
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      updateDropPreview(
        pointerEvent.clientX,
        pointerEvent.clientY,
        getViewerDropZoneAt(pointerEvent.clientX, pointerEvent.clientY),
      )
    }

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      const dropZone = getViewerDropZoneAt(pointerEvent.clientX, pointerEvent.clientY)
      const answer = messages.find((candidate) => candidate.id === message.id)
      cleanup()
      if (!dropZone || !answer) return
      const lineIndex =
        viewerDocument?.kind === "md"
          ? estimateDropLineIndex(viewerDocument.content, pointerEvent.clientX, pointerEvent.clientY, dropZone)
          : undefined
      void onDropAnswer(answer, lineIndex)
    }

    const handlePointerCancel = () => {
      cleanup()
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerCancel)
  }

  return {
    close,
    getActiveDraggedAnswerId,
    handleAnswerDragEnd,
    handleAnswerDragStart,
    handleAnswerPointerDown,
    open,
    restoreAfterAnswerDrag,
    toggle,
    updateDropPreview,
  }
}
