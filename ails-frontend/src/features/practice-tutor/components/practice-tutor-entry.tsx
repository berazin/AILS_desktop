import { MessageSquare } from "lucide-react"
import { usePracticeTutor } from "../practice-tutor-provider.tsx"
import { tutorQuestion } from "../lib/practice-tutor-context.ts"

export function PracticeTutorEntry({ question = false }: { question?: boolean }) {
  const tutor = usePracticeTutor()
  if (!tutor?.context) return null
  return <button type="button" className="code-sandbox-button" aria-label={question ? "AI에게 질문" : "AI 튜터"}
    aria-pressed={!question && tutor.open} data-practice-tutor-entry onClick={() => {
      if (question) {
        tutor.prepare(tutorQuestion(tutor.context!))
      } else tutor.toggle()
    }}><MessageSquare size={12} /><span>{question ? "AI에게 질문" : "AI 튜터"}</span></button>
}
