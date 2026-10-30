import type { ChatbotModelOption } from "./api.ts"
import { t } from "./i18n.ts"

const conceptHeading = /^#{1,6}\s*다시 볼 개념\s*:?\s*$/m

export function chatbotModelName(modelId: string, models: ChatbotModelOption[] = []) {
  return models.find((model) => model.id === modelId)?.name || modelId.split("/").pop() || modelId
}

export function chatbotAnswerForDisplay(answer: string) {
  const heading = conceptHeading.exec(answer)
  if (heading) return answer.slice(0, heading.index).trim()
  const lastLineStart = answer.lastIndexOf("\n") + 1
  const lastLine = answer.slice(lastLineStart).trim().replace(/\s+/g, " ")
  if (lastLine.startsWith("#") && "### 다시 볼 개념".startsWith(lastLine)) {
    return answer.slice(0, lastLineStart).trim()
  }
  return answer.trim()
}

export function chatbotQuestionForDisplay(prompt: string, explicitQuestion = "") {
  if (explicitQuestion.trim()) return explicitQuestion.trim()
  const markedQuestion = /^\[질문\]\s*\n([\s\S]*?)(?:\n\s*\[본문\]|$)/.exec(prompt)
  if (markedQuestion?.[1]) return markedQuestion[1].trim()
  if (/\n\n(?:설명할 파트|강의자료):\s*\n/.test(prompt)) return prompt.split(/\r?\n/, 1)[0].trim()
  return prompt.trim()
}

export function chatSessionMessageKey(documentKey: string, sessionId: string) {
  return sessionId ? `${documentKey}\u0000${sessionId}` : documentKey
}

export function sanitizeChatbotLinkTitle(title: string) {
  return title.replace(/[\r\n\t[\](),]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || t("검색")
}

export function chatbotAnswerTitle(question: string) {
  const title = sanitizeChatbotLinkTitle(question)
  return title.length > 36 ? `${title.slice(0, 36)}...` : title
}

export function extractChatConceptSummary(answer: string) {
  const heading = /^#{1,6}\s*다시 볼 개념\s*:?\s*$/m.exec(answer)
  return heading ? answer.slice(heading.index + heading[0].length).trim() : ""
}

const CHATBOT_TOOL_LABELS: Record<string, string> = {
  grep_search: "문자열 검색",
  semantic_search: "의미 검색",
  read_context: "원문 문맥 확인",
  get_document_outline: "문서 목차 확인",
  inspect_pdf_page: "PDF 원본 페이지 확인",
  calculator: "계산 검증",
  activate_workspace_control: "워크스페이스 조작",
  expert_answer: "전문 모델 위임",
  get_current_page_context: "현재 페이지 확인",
  list_materials: "학습 자료 조회",
  list_workspace_controls: "화면 컨트롤 확인",
  navigate_page: "페이지 이동",
  open_material: "자료 열기",
  open_practice: "문제풀이 열기",
  search_context: "학습 자료 검색",
  search_document: "문서 검색",
  select_tool_categories: "필요한 도구 선택",
  set_sidebar_visibility: "사이드바 설정",
  set_workspace_control: "워크스페이스 입력",
  show_dashboard: "대시보드 열기",
  show_home: "홈 화면 열기",
}

export function chatbotToolLabel(name: string) {
  const label = CHATBOT_TOOL_LABELS[name]
  return label ? t(label) : name.replace(/_/g, " ")
}
