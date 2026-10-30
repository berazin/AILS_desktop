import { IDE_ENABLED } from "../../../edition.ts"
import { useLayoutEffect, useMemo, useRef } from "react"

import type { PdfProblem } from "../../../lib/api.ts"
import {
  groupPdfProblemsForNavigator,
  pdfProblemAnswerInputType,
  pdfProblemAnswerType,
  pdfProblemBinaryPrompt,
  problemForProject,
} from "../../../lib/problem-study.ts"
import { normalizeProjectPath } from "../lib/code-project-browser.ts"
import { practiceQuestionDisplayBlocks } from "../lib/practice-question-display.ts"
import { usePracticeRetrySession } from "./use-practice-retry-session.ts"

export function useCodePracticeProblems({
  baseDir,
  managedProjectList,
  pdfPath,
  problemBaseDir,
  problems,
  practiceProblemId,
  projectName,
  selectedProblemMode,
}: {
  baseDir: string
  managedProjectList: string[]
  pdfPath: string
  problemBaseDir?: string
  problems: PdfProblem[]
  practiceProblemId: string
  projectName: string
  selectedProblemMode: boolean
}) {
  const problemStorageBaseDir = problemBaseDir || baseDir
  const hasConsistentProblemContext = Boolean(
    pdfPath
      && baseDir
      && problemStorageBaseDir
      && normalizeProjectPath(baseDir).toLocaleLowerCase()
        === normalizeProjectPath(problemStorageBaseDir).toLocaleLowerCase(),
  )
  const practiceProblems = useMemo(
    () => hasConsistentProblemContext ? problems : [],
    [hasConsistentProblemContext, problems],
  )
  const codePracticeProblems = useMemo(
    () => practiceProblems.filter((problem) => pdfProblemAnswerType(problem) === "code"),
    [practiceProblems],
  )
  const retrySession = usePracticeRetrySession(`pdf:${pdfPath}:${problemStorageBaseDir}`, practiceProblems)
  const visiblePracticeProblems = retrySession.items
  const navigatorChapters = useMemo(() => groupPdfProblemsForNavigator(visiblePracticeProblems), [visiblePracticeProblems])
  const selectedCatalogProblem = useMemo(
    () => visiblePracticeProblems.find((problem) => problem.id === practiceProblemId) ?? null,
    [practiceProblemId, visiblePracticeProblems],
  )
  const activeProblem = useMemo(
    () => selectedProblemMode
      ? selectedCatalogProblem ?? visiblePracticeProblems[0] ?? null
      : problemForProject(codePracticeProblems, problemStorageBaseDir, projectName),
    [codePracticeProblems, visiblePracticeProblems, problemStorageBaseDir, projectName, selectedCatalogProblem, selectedProblemMode],
  )
  const activeProblemDisplayBlocks = useMemo(
    () => practiceQuestionDisplayBlocks(activeProblem),
    [activeProblem],
  )
  const activeProblemAnswerType = activeProblem ? pdfProblemAnswerType(activeProblem) : null
  const activeProblemAnswerInputType = activeProblem ? pdfProblemAnswerInputType(activeProblem) : null
  const activeProblemBinaryPrompt = useMemo(
    () => activeProblemAnswerInputType === "short_answer" || activeProblemAnswerInputType === "ox"
      ? pdfProblemBinaryPrompt(activeProblem?.problem_text, activeProblemAnswerInputType === "ox")
      : null,
    [activeProblem?.problem_text, activeProblemAnswerInputType],
  )
  const activeProblemDataScope = `${pdfPath}\u0000${problemStorageBaseDir}`
  const activeProblemScope = `${activeProblemDataScope}\u0000${projectName}\u0000${activeProblem?.id || ""}\u0000${activeProblem?.solve_round_id || ""}`
  const activeProblemDataScopeRef = useRef(activeProblemDataScope)
  const activeProblemScopeRef = useRef(activeProblemScope)
  useLayoutEffect(() => {
    activeProblemDataScopeRef.current = activeProblemDataScope
    activeProblemScopeRef.current = activeProblemScope
  }, [activeProblemDataScope, activeProblemScope])
  const problemFolderRevision = useMemo(
    () => practiceProblems.flatMap((problem) => {
      const chapterFolder = normalizeProjectPath(problem.chapter_folder || "")
      return [
        chapterFolder,
        chapterFolder && problem.folder_name ? `${chapterFolder}/${problem.folder_name}` : "",
        problem.folder_path || "",
      ]
    }).filter(Boolean).sort().join("\n"),
    [practiceProblems],
  )
  const managedProblemProjectPaths = useMemo(() => {
    const paths = new Set<string>()
    const addAncestors = (candidate: string) => {
      const parts = normalizeProjectPath(candidate).split("/").filter(Boolean)
      for (let depth = 1; depth <= parts.length; depth += 1) {
        paths.add(parts.slice(0, depth).join("/").toLocaleLowerCase())
      }
    }
    for (const managedPath of managedProjectList) addAncestors(managedPath)
    for (const problem of practiceProblems) {
      const chapterFolder = normalizeProjectPath(problem.chapter_folder || "")
      addAncestors(chapterFolder)
      addAncestors(chapterFolder && problem.folder_name ? `${chapterFolder}/${problem.folder_name}` : "")
      addAncestors(problem.folder_path || "")
    }
    return paths
  }, [managedProjectList, practiceProblems])
  const isManagedProblemProjectPath = (path: string) => (
    managedProblemProjectPaths.has(normalizeProjectPath(path).toLocaleLowerCase())
  )

  return {
    retrySession,
    visiblePracticeProblems,
    activeProblem,
    activeProblemAnswerInputType,
    activeProblemAnswerType,
    activeProblemBinaryPrompt,
    activeProblemDataScope,
    activeProblemDataScopeRef,
    activeProblemDisplayBlocks,
    activeProblemScope,
    activeProblemScopeRef,
    codeWorkspaceVisible: IDE_ENABLED && (!selectedProblemMode || activeProblemAnswerType === "code"),
    hasConsistentProblemContext,
    isManagedProblemProjectPath,
    navigatorChapters,
    problemFolderRevision,
    problemStorageBaseDir,
    practiceProblems,
  }
}
