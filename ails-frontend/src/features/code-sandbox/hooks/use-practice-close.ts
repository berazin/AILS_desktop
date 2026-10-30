import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react"
import { savePdfProblemCodeDraft, type PdfProblem } from "../../../lib/api.ts"
import { t } from "../../../lib/i18n.ts"
import { normalizeProjectPath } from "../lib/code-project-browser.ts"
import { consoleErrorMessage, isProblemMetadataFile, projectPathForPdfProblem, type SandboxFile } from "../lib/code-sandbox-support.ts"

export function usePracticeClose(context: {
  blocked: boolean
  practiceWindow: boolean
  answerDirty: boolean
  dirtyFiles: SandboxFile[]
  problems: PdfProblem[]
  projectName: string
  baseDir: string
  pdfPath: string
  scope: string
  scopeRef: RefObject<string>
  flushAnswer: () => Promise<PdfProblem | null>
  flushCodeDrafts: () => void
  cancelProjectRequests: () => void
  stopRun: () => unknown
  setFiles: Dispatch<SetStateAction<SandboxFile[]>>
  onError: (message: string) => void
  onKeyboardCaptureChange?: (capture: boolean) => void
  onClose: () => void
}) {
  const pending = useRef(false)
  return async () => {
    if (pending.current || context.blocked) return
    if (!context.practiceWindow && context.dirtyFiles.length && !confirm(`${context.dirtyFiles.length} file(s) have unsaved changes. Close anyway?`)) return
    pending.current = true
    try {
      if (context.answerDirty && !await context.flushAnswer()) return
      if (context.scopeRef.current !== context.scope) return
      if (context.practiceWindow && context.dirtyFiles.length) {
        const problem = context.problems.find(problem => projectPathForPdfProblem(problem, context.baseDir) === normalizeProjectPath(context.projectName))
        if (problem) {
          const submitted = context.dirtyFiles.filter(file => !isProblemMetadataFile(file.name))
          await savePdfProblemCodeDraft({ pdf_path: context.pdfPath, base_dir: context.baseDir, problem_id: problem.id, solve_round_id: problem.solve_round_id,
            draft_files: submitted.map(file => ({ name: file.name, code: file.code })) })
          context.setFiles(current => current.map(file => {
            const saved = submitted.find(item => item.id === file.id && item.code === file.code)
            return saved ? { ...file, savedCode: saved.code } : file
          }))
        }
      }
      if (context.scopeRef.current !== context.scope) return
      context.flushCodeDrafts()
      context.cancelProjectRequests()
      context.stopRun()
      context.onKeyboardCaptureChange?.(false)
      context.onClose()
    } catch (error) { context.onError(consoleErrorMessage(error, t("답안을 저장하지 못했습니다."))) }
    finally { pending.current = false }
  }
}
