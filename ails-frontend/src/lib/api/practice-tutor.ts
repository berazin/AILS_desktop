export type PracticeTutorContext = {
  source_kind: "pdf" | "summary"
  source_path: string
  question_id: string
  number: number
  round_id: string
  round_number: number
  page?: number
  question: string
  choices: Array<{ id: string; text: string }>
  code: string[]
  user_answer: string
  selected_choice: string
  phase: "solving" | "graded"
  include_context: boolean
  selected_text?: string
  result?: { correct: boolean; feedback: string; explanation?: string; reference_answer?: string }
}

export type PracticeChatHistoryEntry = {
  role: "user" | "assistant"
  content: string
  practice_context?: PracticeTutorContext
}

export function practiceTutorLabel(context: PracticeTutorContext) {
  return `${context.number}번 · ${context.round_number}회차${context.page ? ` · ${context.page}쪽` : ""} · ${context.phase === "graded" ? "채점 후" : "채점 전"}`
}

export function practiceTutorScope(context: PracticeTutorContext) {
  return `${context.source_path}:${context.question_id}:${context.round_id || context.round_number}`
}
