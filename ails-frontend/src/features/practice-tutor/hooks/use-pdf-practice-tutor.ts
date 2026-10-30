import { useMemo } from "react"
import type { PdfProblem, PdfProblemGradingSummary } from "../../../lib/api"
import type { SandboxFile } from "../../code-sandbox/lib/code-sandbox-support.ts"
import { pdfTutorContext } from "../lib/practice-tutor-context.ts"
import { usePracticeTutorQuestion } from "../practice-tutor-provider.tsx"

export function usePdfPracticeTutor(problem: PdfProblem | null, path: string, answer: string, choice: number | null,
  grade: PdfProblemGradingSummary | null, files: SandboxFile[], sidebar: number, active: boolean, normalSidebar = sidebar) {
  const context = useMemo(() => problem ? pdfTutorContext(problem, path, answer, choice, grade,
    (problem.answer_type_override ?? problem.answer_type) === "code" ? files.map(file => ({ name: file.name, content: file.code })) : []) : null,
  [problem, path, answer, choice, grade, files])
  return usePracticeTutorQuestion(context, sidebar, active, normalSidebar)
}
