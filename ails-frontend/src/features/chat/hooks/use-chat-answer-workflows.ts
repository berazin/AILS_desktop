import { saveChatbotAnswer } from "../../../lib/api"
import { sanitizeChatbotLinkTitle } from "../../../lib/chatbot-display.ts"
import { t } from "../../../lib/i18n.ts"
import type { ChatController, ChatMessage } from "./use-chat-controller.ts"

type UseChatAnswerWorkflowsOptions = {
  chat: ChatController
  document: {
    applyMarkdownContent: (content: string, previousContent: string) => Promise<void>
    currentContent: string
    isMarkdown: boolean
    previousContent: string
    targetFilePath?: string
  }
  refreshMaterials: () => Promise<unknown>
  runInteraction: (
    key: string,
    label: string,
    action: () => Promise<string | void>,
    onError?: (error: unknown) => void,
  ) => Promise<void>
}

function insertMarkdownLinkAtLine(content: string, markdownLink: string, lineIndex: number) {
  const lines = content.split(/\r?\n/)
  const index = Math.min(Math.max(lineIndex, 0), lines.length)
  const before = lines.slice(0, index).join("\n").trimEnd()
  const after = lines.slice(index).join("\n").trimStart()
  return [before, markdownLink, after].filter(Boolean).join("\n\n")
}

export function useChatAnswerWorkflows({
  chat,
  document,
  refreshMaterials,
  runInteraction,
}: UseChatAnswerWorkflowsOptions) {
  const {
    drag: { setDroppedAnswerLinks },
    messages: { nextChatId },
  } = chat

  async function saveAnswer(answer: ChatMessage, lineIndex?: number) {
    if (answer.role !== "assistant") return
    await runInteraction("chatbot-save-answer", "chatbot answer save", async () => {
      const result = await saveChatbotAnswer({
        title: sanitizeChatbotLinkTitle(answer.title || t("챗봇 답변")),
        answer: answer.content,
        target_file_path: document.targetFilePath,
        insert_line_index: lineIndex,
      })
      if (document.isMarkdown && typeof lineIndex === "number") {
        const nextContent = result.updated_raw_content
          ?? insertMarkdownLinkAtLine(document.currentContent, result.markdown_link, lineIndex)
        await document.applyMarkdownContent(nextContent, document.previousContent)
      }
      setDroppedAnswerLinks((current) => [
        ...current,
        { id: nextChatId("answer-link"), title: result.title, link: result.markdown_link },
      ])
      await refreshMaterials()
      return t("답변을 MD 파일로 저장했습니다: {p0}", { p0: result.title })
    })
  }

  return { saveAnswer }
}
