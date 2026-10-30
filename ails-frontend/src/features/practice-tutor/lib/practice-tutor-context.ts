import type { PdfProblem, PdfProblemGradingSummary } from "../../../lib/api"
import type { MaterialPracticeQuestion } from "../../../lib/api/material-practice.ts"
import type { PracticeTutorContext } from "../../../lib/api/practice-tutor.ts"

export function pdfTutorContext(problem: PdfProblem, path: string, answer: string, choice: number | null,
  grade: PdfProblemGradingSummary | null, files: Array<{ name: string; content: string }> = []): PracticeTutorContext {
  const graded = grade?.correct === true || grade?.correct === false
  return {
    source_kind: "pdf", source_path: path, question_id: problem.id, number: problem.number,
    round_id: problem.solve_round_id ?? "", round_number: problem.solve_round_number ?? 1, page: problem.page,
    question: problem.problem_text ?? "", choices: (problem.choices ?? []).map((text, i) => ({ id: String(i + 1), text })),
    code: [...(problem.code ?? []), ...files.map(file => `${file.name}\n${file.content}`)],
    user_answer: answer, selected_choice: choice == null ? "" : String(choice + 1),
    phase: graded ? "graded" : "solving", include_context: true,
    ...(graded ? { result: { correct: grade!.correct as boolean, feedback: grade!.feedback, explanation: grade!.reasoning_summary } } : {}),
  }
}

export function materialTutorContext(question: MaterialPracticeQuestion, path: string, answer: string): PracticeTutorContext {
  const result = question.current_result
  return {
    source_kind: "summary", source_path: path, question_id: question.id, number: question.ordinal,
    round_id: question.solve_round_id ?? "", round_number: question.solve_round_number ?? 1,
    question: question.question, choices: question.options.map(option => ({ id: option.id, text: option.text })), code: [],
    user_answer: answer, selected_choice: question.selected_option_id, phase: result ? "graded" : "solving", include_context: true,
    ...(result ? { result: { correct: result.correct, feedback: result.feedback ?? "", explanation: result.explanation,
      reference_answer: question.reference_answer ?? question.options.find(option => option.id === result.answer_option_id)?.text } } : {}),
  }
}

export function tutorQuestion(context: PracticeTutorContext) {
  return context.phase === "graded"
    ? "내 답안과 채점 결과를 비교해서, 이 문제에서 정답이 되는 이유와 헷갈리기 쉬운 개념을 설명해 줘."
    : "이 문제를 스스로 풀 수 있도록 필요한 개념과 접근 방법을 단계적으로 안내해 줘. 정답은 바로 알려주지 마."
}
