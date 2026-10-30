import { useMemo } from "react"
import type { MaterialPracticeQuestion } from "../../../lib/api/material-practice.ts"
import { materialTutorContext } from "../lib/practice-tutor-context.ts"
import { usePracticeTutorQuestion } from "../practice-tutor-provider.tsx"

export function useMaterialPracticeTutor(question: MaterialPracticeQuestion | null, path: string, answer: string, sidebar: number, normalSidebar = sidebar, active = true) {
  const context = useMemo(() => question ? materialTutorContext(question, path, answer) : null, [question, path, answer])
  return usePracticeTutorQuestion(context, sidebar, active, normalSidebar)
}
