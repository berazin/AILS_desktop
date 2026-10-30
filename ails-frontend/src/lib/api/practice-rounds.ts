export type PracticeRetryMode = "wrong" | "selected" | "all"

export interface PracticeSolveRound {
  id: string
  number: number
  question_text?: string
  answer_text?: string
  selected_answer?: string
  workspace_path?: string
  files?: Array<{ name: string; code: string }>
  elapsed_seconds: number
  graded_at?: string | null
  grading?: { correct?: boolean | null; feedback?: string; explanation?: string } | null
}
