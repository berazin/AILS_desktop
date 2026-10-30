import { useRef, useState, type RefObject } from "react"
import { retryPdfProblem, retryPdfProblemsBatch, type PdfProblem, type PracticeRetryMode } from "../../../lib/api.ts"
import { readCodeProjectDraft } from "../lib/code-project-draft-storage.ts"
import { codeProjectLoadScope, isProblemMetadataFile, projectPathForPdfProblem, type SandboxFile } from "../lib/code-sandbox-support.ts"
import { t } from "../../../lib/i18n.ts"

export function usePdfPracticeRetry(context: {
  problem: PdfProblem | null
  pdfPath: string
  baseDir: string
  scope: string
  scopeRef: RefObject<string>
  actionLock: RefObject<{ kind: "timer" | "type" | "grade" | "review" | "edit"; scope: string; token: number } | null>
  flushAnswer: () => Promise<PdfProblem | null>
  answerDirty: boolean
  files: SandboxFile[]
  projectName: string
  loadedProjectScopeRef: RefObject<string>
  onChange?: (problem: PdfProblem) => void
  onError: (error: string) => void
  problems: PdfProblem[]
  selectedIds: Set<string>
  dataScope: string
  dataScopeRef: RefObject<string>
  onBatchChange: (mode: PracticeRetryMode, problems: PdfProblem[], ids: string[]) => void
}) {
  const { actionLock: actionLockRef, scopeRef } = context
  const [retrying, setRetrying] = useState(false)
  const pending = useRef(false)
  const retry = async () => {
    const { problem, scope } = context
    if (!problem || !problem.last_grading || pending.current || actionLockRef.current) return
    const lock = { kind: "edit" as const, scope, token: -1 }
    actionLockRef.current = lock
    pending.current = true
    setRetrying(true)
    context.onError("")
    try {
      if (context.answerDirty && !await context.flushAnswer()) throw new Error(t("답안을 저장하지 못했습니다."))
      if (problem.answer_type === "code") {
        if (context.loadedProjectScopeRef.current !== codeProjectLoadScope(context.baseDir, projectPathForPdfProblem(problem, context.baseDir))) throw new Error(t("코드 폴더를 여는 중입니다."))
      }
      if (scopeRef.current !== scope) return
      const result = await retryPdfProblem({ pdf_path: context.pdfPath, base_dir: context.baseDir, problem_id: problem.id, solve_round_id: problem.solve_round_id,
        draft_files: problem.answer_type === "code" ? context.files.filter(file => file.code !== file.savedCode && !isProblemMetadataFile(file.name)).map(file => ({ name: file.name, code: file.code })) : undefined })
      if (scopeRef.current === scope) context.onChange?.(result.problem)
    } catch (error) {
      if (scopeRef.current === scope) context.onError(error instanceof Error ? error.message : String(error))
    } finally {
      if (actionLockRef.current === lock) actionLockRef.current = null
      pending.current = false
      setRetrying(false)
    }
  }
  const retryBatch = async (mode: PracticeRetryMode) => {
    if (pending.current || actionLockRef.current) return
    const targets = context.problems.filter(problem => mode === "wrong"
      ? (problem.last_solve_correct ?? problem.last_grading?.correct) === false
      : mode === "all" || context.selectedIds.has(problem.id))
    if (!targets.length) { context.onError(t("다시 풀 대상 문항이 없습니다.")); return }
    const lock = { kind: "edit" as const, scope: context.scope, token: -2 }
    actionLockRef.current = lock
    pending.current = true
    setRetrying(true)
    context.onError("")
    try {
      if (context.answerDirty && !await context.flushAnswer()) throw new Error(t("답안을 저장하지 못했습니다."))
      const items = targets.map(problem => {
        let draftFiles: Array<{ name: string; code: string }> | undefined
        if (problem.answer_type === "code") {
          const path = projectPathForPdfProblem(problem, context.baseDir)
          if (context.loadedProjectScopeRef.current === codeProjectLoadScope(context.baseDir, path)) {
            draftFiles = context.files.filter(file => file.code !== file.savedCode && !isProblemMetadataFile(file.name)).map(file => ({ name: file.name, code: file.code }))
          } else {
            const cached = readCodeProjectDraft(localStorage, context.baseDir, path)
            if (cached) {
              const drafts: unknown = JSON.parse(cached)
              if (!drafts || typeof drafts !== "object" || Array.isArray(drafts) || Object.values(drafts).some(code => typeof code !== "string")) throw new Error(t("코드 임시 답안을 확인해 주세요."))
              draftFiles = Object.entries(drafts as Record<string, string>).filter(([name]) => !isProblemMetadataFile(name)).map(([name, code]) => ({ name, code }))
            }
          }
        }
        return { problem_id: problem.id, solve_round_id: problem.solve_round_id, draft_files: draftFiles }
      })
      if (context.dataScopeRef.current !== context.dataScope) return
      const result = await retryPdfProblemsBatch({ pdf_path: context.pdfPath, base_dir: context.baseDir, mode, items })
      if (context.dataScopeRef.current !== context.dataScope) return
      for (const problem of result.problems) context.onChange?.(problem)
      context.onBatchChange(mode, result.problems, result.target_ids)
    } catch (error) {
      if (context.dataScopeRef.current === context.dataScope) context.onError(error instanceof Error ? error.message : String(error))
    } finally {
      if (actionLockRef.current === lock) actionLockRef.current = null
      pending.current = false
      setRetrying(false)
    }
  }
  return { retryActiveProblem: retry, retryProblems: retryBatch, isProblemRetrying: retrying }
}
