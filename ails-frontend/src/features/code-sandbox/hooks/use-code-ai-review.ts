import { t } from "../../../lib/i18n.ts"
import { readConsoleEncoding } from "../lib/console-encoding.ts"
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { runCodeSandbox, reviewCodeSandboxStream, type CodeReviewIssue, type CodeReviewResult } from "../../../lib/api"
import { codeAiReviewScopeKey, filesForCodeAiReview, readCodeAiReviewSession, updateCodeAiReviewSession } from "../lib/code-ai-review.ts"
import { aiIssueTrackingKey, buildLocalRunIssues, consoleErrorMessage, reconcileReviewIssuesWithSource, sandboxSourceSignature, type CodeRunSnapshot, type SandboxFile } from "../lib/code-sandbox-support.ts"

interface CodeAiReviewContext {
  runBeforeReview?: (signal: AbortSignal) => Promise<CodeRunSnapshot>
  scopeKey?: string
  includeNestedFiles?: boolean
  baseDir: string
  projectName: string
  codeWorkspaceVisible: boolean
  activeFile: SandboxFile | undefined
  recordActiveProblemHint: () => void
  setBottomPanelTab: React.Dispatch<React.SetStateAction<"ai_review" | "console">>
  files: SandboxFile[]
  lastProblemRunRef: React.RefObject<CodeRunSnapshot | null>
  setLastRunElapsed: React.Dispatch<React.SetStateAction<string | null>>
  setDebugOutput: React.Dispatch<React.SetStateAction<{ stdout: string; stderr: string; visible: boolean; }>>
}

/** Owns scope-bound AI requests, cancellation, paid response reuse and review publication. */
export function useCodeAiReview(context: CodeAiReviewContext) {
  const {
    baseDir,
    projectName,
    codeWorkspaceVisible,
    activeFile,
    recordActiveProblemHint,
    setBottomPanelTab,
    files,
    lastProblemRunRef,
    setLastRunElapsed,
    setDebugOutput,
  } = context

  const [aiReviewRevision, setAiReviewRevision] = useState(0)

  const aiReviewAbortRef = useRef<AbortController | null>(null)

  const aiReviewAbortScopeRef = useRef("")

  const aiReviewScopeRef = useRef("")

  const aiReviewMountedRef = useRef(true)

  const aiReviewSeqRef = useRef(0)

  const aiReviewScope = context.scopeKey || codeAiReviewScopeKey(baseDir, projectName)

  useLayoutEffect(() => {
    aiReviewScopeRef.current = aiReviewScope
  }, [aiReviewScope])

  const aiReviewSession = useMemo(
    () => {
      void aiReviewRevision
      return readCodeAiReviewSession(aiReviewScope)
    },
    [aiReviewRevision, aiReviewScope],
  )

  const aiReview = aiReviewSession.review

  const aiReviewVisible = aiReviewSession.visible

  const isAiReviewing = aiReviewSession.reviewing

  const aiReviewPhase = aiReviewSession.phase || (isAiReviewing ? "reviewing" : "idle")

  const aiReviewEvaluatedSignature = aiReviewSession.evaluatedSignature

  const aiReviewError = aiReviewSession.error

  useEffect(() => {
    aiReviewMountedRef.current = true
    return () => {
      aiReviewAbortRef.current?.abort()
      aiReviewMountedRef.current = false
      const abortedScope = aiReviewAbortScopeRef.current
      if (abortedScope) {
        updateCodeAiReviewSession(abortedScope, (current) => ({ ...current, reviewing: false }))
        aiReviewAbortScopeRef.current = ""
      }
    }
  }, [])

  function updateAiReviewScope(
    scopeKey: string,
    update: Parameters<typeof updateCodeAiReviewSession>[1],
  ) {
    updateCodeAiReviewSession(scopeKey, update)
    if (aiReviewMountedRef.current) setAiReviewRevision((current) => current + 1)
  }

  function setAiReviewForScope(
    scopeKey: string,
    review: CodeReviewResult | null | ((current: CodeReviewResult | null) => CodeReviewResult | null),
  ) {
    updateAiReviewScope(scopeKey, (current) => ({
      ...current,
      review: typeof review === "function" ? review(current.review) : review,
    }))
  }

  function setAiReviewVisibleForScope(scopeKey: string, visible: boolean) {
    updateAiReviewScope(scopeKey, (current) => ({ ...current, visible }))
  }

  function setAiReviewingForScope(scopeKey: string, reviewing: boolean) {
    updateAiReviewScope(scopeKey, (current) => ({ ...current, reviewing }))
  }

  async function requestAiReview() {
    if (!codeWorkspaceVisible) return
    const reviewScope = aiReviewScope
    if (!activeFile || !reviewScope) return
    if (isAiReviewing) {
      aiReviewAbortRef.current?.abort()
      updateAiReviewScope(reviewScope, (cur) => ({
        ...cur,
        reviewing: false,
        phase: "cancelled",
      }))
      aiReviewAbortScopeRef.current = ""
      return
    }
    recordActiveProblemHint()
    const reviewSeq = ++aiReviewSeqRef.current
    const controller = new AbortController()
    const previousReviewScope = aiReviewAbortScopeRef.current
    aiReviewAbortRef.current?.abort()
    if (previousReviewScope && previousReviewScope !== reviewScope) {
      setAiReviewingForScope(previousReviewScope, false)
    }
    aiReviewAbortRef.current = controller
    aiReviewAbortScopeRef.current = reviewScope
    setBottomPanelTab("ai_review")
    setAiReviewVisibleForScope(reviewScope, true)
    updateAiReviewScope(reviewScope, (cur) => ({
      ...cur,
      reviewing: true,
      phase: "running",
      error: null,
    }))
    setAiReviewForScope(reviewScope, {
      summary: t("코드를 실행한 뒤 현재 챗봇 모델로 진단하고 있습니다."),
      can_run: null,
      issues: [],
    })

    const currentSignature = sandboxSourceSignature(files)
    const filesPayload = files.map((file) => ({ name: file.name, code: file.code }))
    const reviewFiles = filesForCodeAiReview(files, context.includeNestedFiles)
    const reviewFilesPayload = reviewFiles.map((file) => ({ name: file.name, code: file.code }))
    let runResult: {
      success?: boolean | null
      returncode?: number | null
      stdout?: string
      stderr?: string
      error?: string
      diagnostics?: string
    }
    let localRunIssues: CodeReviewIssue[] = []

    const lastRun = lastProblemRunRef.current
    if (!context.runBeforeReview && lastRun && lastRun.action === "run" && lastRun.signature === currentSignature
      && (lastRun.consoleEncoding ?? "auto") === readConsoleEncoding()) {
      runResult = {
        success: lastRun.success,
        returncode: lastRun.returncode,
        stdout: lastRun.stdout,
        stderr: lastRun.stderr,
      }
    } else {
      try {
        const startTime = Date.now()
        runResult = context.runBeforeReview ? await context.runBeforeReview(controller.signal) : await runCodeSandbox(
          {
            code: activeFile.code,
            language: activeFile.language,
            file_name: activeFile.name,
            files: filesPayload,
            stdin: "",
            console_encoding: readConsoleEncoding(),
            timeout: 30,
          },
          controller.signal,
        )
        if (reviewSeq !== aiReviewSeqRef.current) return
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        setLastRunElapsed(elapsed)
        setDebugOutput({
          stdout: runResult.stdout || "",
          stderr: runResult.stderr || "",
          visible: true,
        })
        lastProblemRunRef.current = {
          signature: currentSignature,
          action: "run",
          success: runResult.success ?? null,
          returncode: runResult.returncode ?? (runResult.success ? 0 : 1),
          stdout: runResult.stdout || "",
          stderr: runResult.stderr || "",
          status: runResult.success ? "exited" : "failed",
        }
        localRunIssues = buildLocalRunIssues(runResult, activeFile)
      } catch (error) {
        if (controller.signal.aborted) {
          updateAiReviewScope(reviewScope, (cur) => ({
            ...cur,
            reviewing: false,
            phase: "cancelled",
          }))
          if (aiReviewAbortRef.current === controller) aiReviewAbortRef.current = null
          if (aiReviewAbortScopeRef.current === reviewScope) aiReviewAbortScopeRef.current = ""
          return
        }
        if (context.runBeforeReview) {
          updateAiReviewScope(reviewScope, (cur) => ({ ...cur, reviewing: false, phase: "failed", error: consoleErrorMessage(error, "실행 실패") }))
          if (aiReviewAbortRef.current === controller) aiReviewAbortRef.current = null
          if (aiReviewAbortScopeRef.current === reviewScope) aiReviewAbortScopeRef.current = ""
          return
        }
        runResult = {
          success: false,
          stdout: "",
          stderr: `[Run failed]\n${consoleErrorMessage(error, "Network error")}`,
        }
        localRunIssues = buildLocalRunIssues(runResult, activeFile)
      }
    }

    if (reviewSeq !== aiReviewSeqRef.current || controller.signal.aborted) return

    updateAiReviewScope(reviewScope, (cur) => ({
      ...cur,
      phase: "analyzing",
    }))

    if (localRunIssues.length === 0) {
      localRunIssues = buildLocalRunIssues(runResult, activeFile)
    }

    if (localRunIssues.length > 0) {
      setAiReviewForScope(reviewScope, {
        summary: t("실행 로그에서 오류 위치를 먼저 찾았습니다. AI가 추가 원인 분석을 이어서 진행합니다."),
        can_run: false,
        issues: localRunIssues,
      })
    }

    updateAiReviewScope(reviewScope, (cur) => ({
      ...cur,
      phase: "reviewing",
    }))

    try {
      const result = await reviewCodeSandboxStream(
        {
          project_name: projectName.trim(),
          include_nested_files: context.includeNestedFiles,
          code: activeFile.code,
          language: activeFile.language,
          file_name: activeFile.name,
          files: reviewFilesPayload,
          run_result: runResult,
        },
        {
          onIssue: (streamedIssue) => {
            if (controller.signal.aborted || reviewSeq !== aiReviewSeqRef.current) return
            const [issue] = reconcileReviewIssuesWithSource([streamedIssue], reviewFiles)
            if (!issue) return
            setAiReviewForScope(reviewScope, (current) => {
              const existingIssues = current?.issues || []
              const key = aiIssueTrackingKey(issue, 0)
              if (existingIssues.some((existing) => aiIssueTrackingKey(existing, 0) === key)) return current
              return {
                ...(current || { summary: t("AI 코드 진단을 진행하고 있습니다."), can_run: null }),
                issues: [...existingIssues, issue],
              }
            })
          },
        },
        controller.signal,
      )
      if (reviewSeq !== aiReviewSeqRef.current || controller.signal.aborted) return
      const aiIssues = Array.isArray(result.issues)
        ? reconcileReviewIssuesWithSource(result.issues, reviewFiles)
        : []
      const finalIssues = aiIssues.length > 0 ? aiIssues : localRunIssues
      setAiReviewForScope(reviewScope, {
        summary: result.summary || (finalIssues.length === 0 ? t("발견된 문제가 없습니다.") : t("AI 코드 진단이 완료되었습니다.")),
        can_run: result.can_run ?? (localRunIssues.length > 0 ? false : null),
        issues: finalIssues,
        model: result.model,
        provider: result.provider,
      })
      updateAiReviewScope(reviewScope, (cur) => ({
        ...cur,
        reviewing: false,
        phase: "completed",
        evaluatedSignature: currentSignature,
        error: null,
      }))
      setAiReviewVisibleForScope(reviewScope, true)
    } catch (error) {
      if (controller.signal.aborted) {
        updateAiReviewScope(reviewScope, (cur) => ({
          ...cur,
          reviewing: false,
          phase: "cancelled",
        }))
        return
      }
      const errMsg = consoleErrorMessage(error, t("네트워크 또는 서버 오류가 발생했습니다."))
      if (localRunIssues.length > 0) {
        setAiReviewForScope(reviewScope, {
          summary: t("AI 평가 실패: {p0}", { p0: errMsg }),
          can_run: false,
          issues: localRunIssues,
        })
      } else {
        setAiReviewForScope(reviewScope, null)
      }
      updateAiReviewScope(reviewScope, (cur) => ({
        ...cur,
        reviewing: false,
        phase: "failed",
        error: errMsg,
      }))
      setAiReviewVisibleForScope(reviewScope, true)
    } finally {
      if (aiReviewAbortRef.current === controller) aiReviewAbortRef.current = null
      if (aiReviewAbortScopeRef.current === reviewScope) aiReviewAbortScopeRef.current = ""
      if (reviewSeq === aiReviewSeqRef.current) setAiReviewingForScope(reviewScope, false)
    }
  }

  return {
    requestAiReview,
    aiReview,
    aiReviewScopeRef,
    setAiReviewForScope,
    aiReviewVisible,
    isAiReviewing,
    setAiReviewVisibleForScope,
    aiReviewScope,
    aiReviewEvaluatedSignature,
    aiReviewPhase,
    aiReviewError,
  }
}
