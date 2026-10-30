import { t } from "../../../lib/i18n.ts"
import React, { useEffect, useEffectEvent, useRef } from "react"
import * as Monaco from "monaco-editor"
import { type CodeReviewIssue, type CodeReviewResult, type LanguageProfile } from "../../../lib/api"
import { type CompilerDiagnostic } from "../lib/compiler-diagnostics.ts"
import { aiReviewIssueMatchesFile } from "../lib/code-ai-review.ts"
import { aiIssueTrackingKey, baseName, COMPILER_MARKER_OWNER, monacoLanguageForFile, normalizeFileName, type SandboxFile } from "../lib/code-sandbox-support.ts"

interface CodeEditorAnnotationsContext {
  syncModel?: boolean
  exactDiagnosticPaths?: boolean
  aiReview: CodeReviewResult | null
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>
  monacoRef: React.RefObject<typeof Monaco | null>
  activeFile: SandboxFile | undefined
  compilerDiagnostics: CompilerDiagnostic[]
  files: SandboxFile[]
  setActiveFileId: React.Dispatch<React.SetStateAction<string>>
  activeFileRef: React.RefObject<SandboxFile | undefined>
  aiReviewScopeRef: React.RefObject<string>
  setAiReviewForScope: (scopeKey: string, review: CodeReviewResult | null | ((current: CodeReviewResult | null) => CodeReviewResult | null)) => void
  activeFileId: string
  syntaxTheme: "dark-plus" | "light-plus"
  customLanguageProfiles: LanguageProfile[]
  aiReviewHeight: number
  aiReviewVisible: boolean
  consoleHeight: number
  debugOutput: { stdout: string; stderr: string; visible: boolean; }
  size: { width: number; height: number; }
}

/** Owns Monaco diagnostics, tracked AI issue locations and annotation subscription cleanup. */
export function useCodeEditorAnnotations(context: CodeEditorAnnotationsContext) {
  const {
    aiReview,
    editorRef,
    monacoRef,
    activeFile,
    compilerDiagnostics,
    files,
    setActiveFileId,
    activeFileRef,
    aiReviewScopeRef,
    setAiReviewForScope,
    activeFileId,
    syntaxTheme,
    customLanguageProfiles,
    aiReviewHeight,
    aiReviewVisible,
    consoleHeight,
    debugOutput,
    size,
  } = context

  const aiDecorationIdsRef = useRef<string[]>([])

  const aiDecorationIdsByKeyRef = useRef<Record<string, string>>({})

  const aiIssueLineSyncFrameRef = useRef<number | null>(null)

  const editorLayoutFrameRef = useRef<number | null>(null)

  const editorDisposablesRef = useRef<Monaco.IDisposable[]>([])

  function issuesForFileWithIndex(file: SandboxFile | undefined) {
    if (!file || !aiReview?.issues?.length) return []
    return aiReview.issues
      .map((issue, index) => ({ issue, index }))
      .filter(({ issue }) => aiReviewIssueMatchesFile(issue, file.name))
  }

  function applyCompilerMarkers() {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel?.()
    if (!editor || !monaco || !model || !activeFile) return
    const currentName = normalizeFileName(activeFile.name).toLowerCase()
    const currentBase = baseName(currentName)
    const lineCount = model.getLineCount?.() || 1
    const markers = compilerDiagnostics
      .filter((diagnostic) => {
        const diagnosticFile = normalizeFileName(diagnostic.file).toLowerCase()
        return diagnosticFile === currentName || (!context.exactDiagnosticPaths && baseName(diagnosticFile) === currentBase)
      })
      .map((diagnostic) => {
        const lineNumber = Math.max(1, Math.min(diagnostic.line, lineCount))
        const maxColumn = Math.max(1, model.getLineMaxColumn?.(lineNumber) || 1)
        const startColumn = Math.max(1, Math.min(diagnostic.column, maxColumn))
        return {
          severity:
            diagnostic.severity === "error"
              ? monaco.MarkerSeverity.Error
              : diagnostic.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
          message: diagnostic.explanation,
          source: "Compiler",
          startLineNumber: lineNumber,
          startColumn,
          endLineNumber: lineNumber,
          endColumn: Math.min(maxColumn, startColumn + 1),
        }
      })
    monaco.editor.setModelMarkers(model, COMPILER_MARKER_OWNER, markers)
  }

  function revealLine(fileName?: string, line?: number, column?: number) {
    if (fileName) {
      const issueName = normalizeFileName(fileName || "")
      const target =
        files.find((file) => normalizeFileName(file.name).toLowerCase() === issueName.toLowerCase()) ||
        files.find((file) => baseName(file.name).toLowerCase() === baseName(issueName).toLowerCase())
      if (target) {
        setActiveFileId(target.id)
      }
    }
    window.requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor) return
      const model = editor.getModel?.()
      const lineCount = model?.getLineCount?.() || 1
      const lineNumber = Math.max(1, Math.min(Number(line || 1), lineCount))
      const maxColumn = Math.max(1, model?.getLineMaxColumn?.(lineNumber) || 1)
      const targetColumn = Math.max(1, Math.min(Number(column || 1), maxColumn))
      editor.revealLineInCenter(lineNumber)
      editor.setPosition({ lineNumber, column: targetColumn })
      editor.focus()
    })
  }

  function revealIssue(issue: CodeReviewIssue) {
    revealLine(issue.file, issue.line, issue.column)
  }

  function applyAiDecorations() {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel?.()
    if (!editor || !monaco || !model) return
    const currentIssues = issuesForFileWithIndex(activeFile)
    const lineCount = model.getLineCount?.() || 1
    const decorations = currentIssues.map(({ issue }) => {
      const lineNumber = Math.max(1, Math.min(Number(issue.line || 1), lineCount))
      const maxColumn = Math.max(1, model.getLineMaxColumn?.(lineNumber) || 1)
      const className =
        issue.severity === "error"
          ? "ails-ai-review-line-error"
          : issue.severity === "warning"
            ? "ails-ai-review-line-warning"
            : "ails-ai-review-line-info"
      const glyphClassName =
        issue.severity === "error"
          ? "ails-ai-review-glyph-error"
          : issue.severity === "warning"
            ? "ails-ai-review-glyph-warning"
            : "ails-ai-review-glyph-info"
      const hoverLines = [
        `**${issue.title || t("AI 진단")}**`,
        issue.explanation || "",
        issue.fix ? t("수정 힌트: {p0}", { p0: issue.fix }) : "",
      ].filter(Boolean)
      return {
        range: new monaco.Range(lineNumber, 1, lineNumber, maxColumn),
        options: {
          isWholeLine: true,
          className,
          glyphMarginClassName: glyphClassName,
          hoverMessage: { value: hoverLines.join("\n\n") },
          glyphMarginHoverMessage: { value: hoverLines.join("\n\n") },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      }
    })
    const nextDecorationIds = editor.deltaDecorations(aiDecorationIdsRef.current, decorations)
    const nextDecorationMap: Record<string, string> = {}
    currentIssues.forEach(({ issue, index }, decorationIndex) => {
      nextDecorationMap[aiIssueTrackingKey(issue, index)] = nextDecorationIds[decorationIndex]
    })
    aiDecorationIdsRef.current = nextDecorationIds
    aiDecorationIdsByKeyRef.current = nextDecorationMap
  }

  const applyAiDecorationsFromEffect = useEffectEvent(() => applyAiDecorations())

  const applyCompilerMarkersFromEffect = useEffectEvent(() => applyCompilerMarkers())

  function syncAiIssueLinesFromDecorations() {
    const editor = editorRef.current
    const model = editor?.getModel?.()
    const currentActiveFile = activeFileRef.current
    if (!editor || !model || !currentActiveFile) return
    const decorationIdsByKey = aiDecorationIdsByKeyRef.current
    const lineCount = model.getLineCount?.() || 1
    const currentReviewScope = aiReviewScopeRef.current
    if (!currentReviewScope) return

    setAiReviewForScope(currentReviewScope, (current) => {
      if (!current?.issues?.length) return current
      let changed = false
      const nextIssues = current.issues.map((issue, index) => {
        const belongsToActiveFile = aiReviewIssueMatchesFile(issue, currentActiveFile.name)
        if (!belongsToActiveFile) return issue

        const decorationId = decorationIdsByKey[aiIssueTrackingKey(issue, index)]
        const range = decorationId ? model.getDecorationRange?.(decorationId) : null
        if (!range) return issue

        const nextLine = Math.max(1, Math.min(lineCount, Number(range.startLineNumber || issue.line || 1)))
        const nextColumn = Math.max(1, Number(range.startColumn || issue.column || 1))
        if (nextLine === issue.line && nextColumn === (issue.column || 1) && issue.file === currentActiveFile.name) {
          return issue
        }
        changed = true
        return {
          ...issue,
          file: currentActiveFile.name,
          line: nextLine,
          column: nextColumn,
        }
      })
      return changed ? { ...current, issues: nextIssues } : current
    })
  }

  function scheduleAiIssueLineSync() {
    if (aiIssueLineSyncFrameRef.current !== null) return
    aiIssueLineSyncFrameRef.current = window.requestAnimationFrame(() => {
      aiIssueLineSyncFrameRef.current = null
      syncAiIssueLinesFromDecorations()
    })
  }

  function scheduleEditorLayout() {
    if (editorLayoutFrameRef.current !== null) return
    editorLayoutFrameRef.current = window.requestAnimationFrame(() => {
      editorLayoutFrameRef.current = null
      editorRef.current?.layout?.()
      editorRef.current?.render?.(true)
    })
  }

  useEffect(() => {
    applyAiDecorationsFromEffect()
  }, [aiReview, activeFileId, activeFile?.name])

  useEffect(() => {
    applyCompilerMarkersFromEffect()
  }, [compilerDiagnostics, activeFileId, activeFile?.name])

  const scheduleEditorLayoutFromEffect = useEffectEvent(scheduleEditorLayout)

  useEffect(() => {
    if (context.syncModel === false || !activeFile || !editorRef.current || !monacoRef.current) return
    const model = editorRef.current.getModel?.()
    if (!model) return
    if (model.getValue?.() !== activeFile.code) {
      model.setValue?.(activeFile.code)
    }
    monacoRef.current.editor.setModelLanguage(model, monacoLanguageForFile(activeFile))
    monacoRef.current.editor.setTheme(syntaxTheme)
    scheduleEditorLayoutFromEffect()
    window.requestAnimationFrame(() => applyCompilerMarkersFromEffect())
  }, [activeFile, customLanguageProfiles, syntaxTheme, editorRef, monacoRef, context.syncModel])

  useEffect(() => {
    scheduleEditorLayoutFromEffect()
  }, [aiReviewHeight, aiReviewVisible, consoleHeight, debugOutput.visible, size.height, size.width])

  useEffect(() => () => {
    editorDisposablesRef.current.forEach((disposable) => disposable?.dispose?.())
    editorDisposablesRef.current = []
    if (aiIssueLineSyncFrameRef.current !== null) window.cancelAnimationFrame(aiIssueLineSyncFrameRef.current)
    if (editorLayoutFrameRef.current !== null) window.cancelAnimationFrame(editorLayoutFrameRef.current)
    aiIssueLineSyncFrameRef.current = null
    editorLayoutFrameRef.current = null
  }, [])

  return {
    editorDisposablesRef,
    revealLine,
    revealIssue,
    scheduleEditorLayout,
    scheduleAiIssueLineSync,
    applyAiDecorations,
    applyCompilerMarkers,
  }
}
