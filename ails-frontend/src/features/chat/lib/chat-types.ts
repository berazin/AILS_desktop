export type ChatActivity = {
  phase: "thinking" | "tool" | "results" | "writing"
  label: string
}

export type ChatMessage = {
  evidence?: import("../lib/answer-evidence.ts").AnswerEvidence[]
  webSearch?: import("../../../lib/api/chatbot.ts").WebSearchReport
  practiceContext?: import("../../../lib/api/practice-tutor.ts").PracticeTutorContext
  id: string
  role: "user" | "assistant"
  content: string
  activity?: ChatActivity
  generationStopped?: boolean
  generationFailed?: boolean
  title?: string
  answerSource?: "local" | "cloud"
  cloudMode?: "supplement" | "fallback"
  cloudRecommended?: boolean
  cloudReason?: string
  originalQuestion?: string
}

export type ChatMessagesByDocument = Record<string, ChatMessage[]>
