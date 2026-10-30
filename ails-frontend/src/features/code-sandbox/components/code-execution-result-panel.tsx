import { t } from "../../../lib/i18n.ts"
import React from "react"
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Info,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react"
import { type CodeReviewIssue, type CodeReviewResult } from "../../../lib/api"
import { type CompilerDiagnostic } from "../lib/compiler-diagnostics.ts"
import {
  consoleStatusLabel,
  issueBadgeClass,
  issueColorClass,
  issueSeverityLabel,
  sandboxSourceSignature,
  stderrLineColor,
  type ConsoleStatus,
  type SandboxFile,
} from "../lib/code-sandbox-support.ts"

interface CodeExecutionResultPanelProps {
  maxHeight?: string
  aiReviewFontSize?: number
  isConsoleResizeHovered: boolean
  handleConsoleBorderMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  isConsoleResizing: boolean
  setIsConsoleResizeHovered: React.Dispatch<React.SetStateAction<boolean>>
  handleConsoleBorderMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void
  consoleHeight: number
  setBottomPanelTab: React.Dispatch<React.SetStateAction<"ai_review" | "console">>
  bottomPanelTab: "ai_review" | "console"
  consoleStatus: ConsoleStatus
  aiReviewVisible: boolean
  setAiReviewVisibleForScope: (scopeKey: string, visible: boolean) => void
  aiReviewScope: string
  isAiReviewing: boolean
  aiReview: CodeReviewResult | null
  setIsConsoleInputSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setDebugOutput: React.Dispatch<React.SetStateAction<{ stdout: string; stderr: string; visible: boolean; }>>
  firstRunNoticeAcknowledged: boolean
  setFirstRunNoticeAcknowledged: React.Dispatch<React.SetStateAction<boolean>>
  activeFile: SandboxFile | undefined
  projectName: string
  consoleReturnCode: number | null
  lastRunElapsed: string | null
  compilerDiagnostics: CompilerDiagnostic[]
  revealLine: (fileName?: string, line?: number, column?: number) => void
  consoleOutputRef: React.RefObject<HTMLDivElement | null>
  debugOutput: { stdout: string; stderr: string; visible: boolean; }
  consoleTruncated: boolean
  isDebugging: boolean
  isConsoleInputSettingsOpen: boolean
  isConsoleInputRetained: boolean
  updateConsoleInputRetained: (retained: boolean) => void
  updateConsoleAutoInput: (input: string) => void
  consoleAutoInput: string
  hasRunSession: boolean
  consoleInputClosed: boolean
  isSendingConsoleInput: boolean
  submitConsoleInput: (eof?: boolean) => Promise<void>
  setConsoleInput: React.Dispatch<React.SetStateAction<string>>
  consoleInputRef: React.RefObject<HTMLInputElement | null>
  consoleInput: string
  aiReviewPanelRef: React.RefObject<HTMLDivElement | null>
  handleAiReviewWheel: (event: React.WheelEvent<HTMLDivElement>) => void
  aiReviewEvaluatedSignature: string | undefined
  files: SandboxFile[]
  requestAiReview: () => Promise<void>
  aiReviewPhase: import("../lib/code-ai-review.ts").CodeAiReviewPhase
  aiReviewError: string | null | undefined
  revealIssue: (issue: CodeReviewIssue) => void
}

export function CodeExecutionResultPanel({
  maxHeight,
  aiReviewFontSize,
  isConsoleResizeHovered,
  handleConsoleBorderMouseDown,
  isConsoleResizing,
  setIsConsoleResizeHovered,
  handleConsoleBorderMouseMove,
  consoleHeight,
  setBottomPanelTab,
  bottomPanelTab,
  consoleStatus,
  aiReviewVisible,
  setAiReviewVisibleForScope,
  aiReviewScope,
  isAiReviewing,
  aiReview,
  setIsConsoleInputSettingsOpen,
  setDebugOutput,
  firstRunNoticeAcknowledged,
  setFirstRunNoticeAcknowledged,
  activeFile,
  projectName,
  consoleReturnCode,
  lastRunElapsed,
  compilerDiagnostics,
  revealLine,
  consoleOutputRef,
  debugOutput,
  consoleTruncated,
  isDebugging,
  isConsoleInputSettingsOpen,
  isConsoleInputRetained,
  updateConsoleInputRetained,
  updateConsoleAutoInput,
  consoleAutoInput,
  hasRunSession,
  consoleInputClosed,
  isSendingConsoleInput,
  submitConsoleInput,
  setConsoleInput,
  consoleInputRef,
  consoleInput,
  aiReviewPanelRef,
  handleAiReviewWheel,
  aiReviewEvaluatedSignature,
  files,
  requestAiReview,
  aiReviewPhase,
  aiReviewError,
  revealIssue,
}: CodeExecutionResultPanelProps) {
  return (
    <div
      className={`ails-code-layout-border relative z-40 flex shrink-0 flex-col border-t bg-[var(--panel)]/95 p-3 font-mono text-[11px] text-[var(--foreground)] shadow-2xl ${isConsoleResizeHovered ? "ails-code-console-border-resize" : ""}`}
      onMouseDownCapture={handleConsoleBorderMouseDown}
      onMouseLeave={() => {
        if (!isConsoleResizing) setIsConsoleResizeHovered(false)
      }}
      onMouseMoveCapture={handleConsoleBorderMouseMove}
      style={{ height: consoleHeight, maxHeight, cursor: isConsoleResizeHovered ? "ns-resize" : undefined }}
    >
      {/* Top bar with tabs: 콘솔 | AI 코드 리뷰 and Close button */}
      <div className="ails-code-layout-border-subtle mb-1.5 flex shrink-0 items-center justify-between gap-2 border-b pb-1">
        <div className="flex items-center gap-1 font-sans">
          <button
            type="button"
            onClick={() => setBottomPanelTab("console")}
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
              bottomPanelTab === "console"
                ? "bg-[var(--brand)] text-white font-bold"
                : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            <Terminal size={12} />
            <span>{t("콘솔")}</span>
            {(consoleStatus === "running" || consoleStatus === "starting") && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setBottomPanelTab("ai_review")
              if (!aiReviewVisible) setAiReviewVisibleForScope(aiReviewScope, true)
            }}
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
              bottomPanelTab === "ai_review"
                ? "bg-[var(--brand)] text-white font-bold"
                : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            <Bot size={12} />
            <span>{t("AI 코드 리뷰")}</span>
            {isAiReviewing && (
              <RefreshCw className="animate-spin text-violet-500 dark:text-violet-400" size={10} />
            )}
            {!isAiReviewing && (aiReview?.issues?.length ?? 0) > 0 && (
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                {aiReview!.issues.length}
              </span>
            )}
          </button>
        </div>

        <button
          className="rounded-full bg-black/5 dark:bg-white/5 p-0.5 text-[var(--muted-foreground)] hover:bg-black/10 dark:hover:bg-white/10 hover:text-[var(--foreground)]"
          onClick={() => {
            setIsConsoleInputSettingsOpen(false)
            setDebugOutput((current) => ({ ...current, visible: false }))
            setAiReviewVisibleForScope(aiReviewScope, false)
          }}
          title={t("패널 닫기")}
          type="button"
        >
          <X size={11} />
        </button>
      </div>

      {/* Tab 1: Console */}
      {bottomPanelTab === "console" && (
        <>
          {/* First run disclaimer banner */}
          {!firstRunNoticeAcknowledged && (
            <div className="mb-1.5 flex items-center justify-between gap-2 rounded border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[10px] text-blue-700 dark:text-blue-200 font-sans">
              <div className="flex items-center gap-1.5">
                <Info size={12} className="shrink-0 text-blue-600 dark:text-blue-400" />
                <span>{t("코드는 로컬 컴퓨터의 사용자 권한으로 실행됩니다.")}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem("ails_code_sandbox_first_run_acknowledged", "true")
                  } catch {
                    // ignore storage error
                  }
                  setFirstRunNoticeAcknowledged(true)
                }}
                className="shrink-0 rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:text-blue-200 hover:bg-blue-500/30 transition-colors"
              >
                {t("확인")}
              </button>
            </div>
          )}

          {/* Console Status Header */}
          <div className="mb-1 flex shrink-0 items-center justify-between text-[10px] text-[var(--muted-foreground)]">
            <div className="flex min-w-0 items-center gap-1.5 font-mono">
              <span className="truncate text-[var(--foreground)] font-medium">{activeFile?.name || projectName}</span>
              {activeFile && activeFile.code !== activeFile.savedCode && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">({t("저장하지 않은 코드")})</span>
              )}
              <span>·</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                  consoleStatus === "running" || consoleStatus === "starting"
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : consoleStatus === "stopping"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : consoleStatus === "failed" || consoleStatus === "timed_out"
                        ? "bg-red-500/15 text-red-700 dark:text-red-300"
                        : "bg-black/5 dark:bg-white/10 text-[var(--muted-foreground)]"
                }`}
              >
                {consoleStatusLabel(consoleStatus, consoleReturnCode)}
              </span>
              {lastRunElapsed && (
                <span className="text-[var(--muted-foreground)]">{lastRunElapsed}{t("초")}</span>
              )}
            </div>
          </div>

          {/* Clickable compiler diagnostics */}
          {compilerDiagnostics.length > 0 && (
            <div className="mb-1.5 max-h-24 overflow-y-auto rounded border border-red-500/30 bg-red-500/10 p-1.5 font-sans text-[10px]">
              <div className="mb-1 font-semibold text-red-700 dark:text-red-300">
                {t("컴파일 진단 ({p0}건)", { p0: compilerDiagnostics.length })}
              </div>
              <div className="space-y-1">
                {compilerDiagnostics.map((diag, index) => (
                  <button
                    key={`${diag.file}-${diag.line}-${index}`}
                    type="button"
                    onClick={() => revealLine(diag.file, diag.line, diag.column)}
                    className="flex w-full items-center gap-1.5 rounded border border-black/5 dark:border-white/5 bg-white/70 dark:bg-black/40 px-2 py-0.5 text-left hover:bg-white dark:hover:bg-black/60 transition-colors"
                    title={t("에디터 {p0}행으로 이동", { p0: diag.line })}
                  >
                    <span className={`rounded px-1 text-[9px] font-bold uppercase ${diag.severity === "error" ? "bg-red-500/20 text-red-700 dark:text-red-300" : "bg-amber-500/20 text-amber-700 dark:text-amber-300"}`}>
                      {diag.severity === "error" ? t("오류") : t("경고")}
                    </span>
                    <span className="font-mono text-[var(--muted-foreground)]">{diag.line}행</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{diag.explanation}</span>
                    <span className="shrink-0 text-[9px] text-blue-600 dark:text-blue-400 hover:underline">{t("이동 →")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Console output */}
          <div data-ails-code-console="true" ref={consoleOutputRef} className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-slate-50 dark:bg-zinc-950/90 p-2 font-mono text-[12px] leading-relaxed">
            {debugOutput.stdout && <div className="text-slate-900 dark:text-zinc-100">{debugOutput.stdout}</div>}
            {debugOutput.stderr && (
              <div className="font-semibold">
                {debugOutput.stderr.split(/\r?\n/).map((line, index) => (
                  <div className={stderrLineColor(line)} key={`${index}-${line}`}>{line || "\u00a0"}</div>
                ))}
              </div>
            )}
            {consoleTruncated && <div className="font-semibold text-amber-600 dark:text-amber-400">[Output truncated]</div>}
            {!debugOutput.stdout && !debugOutput.stderr && (
              <div className="italic text-slate-500 dark:text-zinc-500">
                {isDebugging ? "Waiting for program output..." : "Program finished with no output."}
              </div>
            )}
            {!isDebugging && (consoleStatus === "exited" || consoleStatus === "failed" || consoleStatus === "timed_out") && (
              <div className={`mt-2 flex items-center gap-1.5 text-[10px] font-sans font-semibold ${consoleStatus === "exited" && consoleReturnCode === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                {consoleStatus === "exited" && consoleReturnCode === 0 ? (
                  <>
                    <Check size={11} />
                    <span>{t("실행 성공")}{lastRunElapsed ? ` · ${lastRunElapsed}${t("초")}` : ""}{consoleReturnCode !== null ? ` · ${t("종료 코드")} ${consoleReturnCode}` : ""}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={11} />
                    <span>{t("실행 실패")}{lastRunElapsed ? ` · ${lastRunElapsed}${t("초")}` : ""}{consoleReturnCode !== null ? ` · ${t("종료 코드")} ${consoleReturnCode}` : ""}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Input Settings Popover */}
          {isConsoleInputSettingsOpen && (
            <div
              className="ails-code-layout-border absolute right-3 bottom-14 z-50 w-72 rounded-md border bg-[var(--panel)] p-2.5 font-sans shadow-2xl text-[var(--foreground)]"
              data-console-auto-input-settings="true"
            >
              <div className="mb-2 flex items-center justify-between border-b border-[var(--border)] pb-1 text-[11px] font-semibold text-[var(--foreground)]">
                <span className="flex items-center gap-1.5">
                  <Settings size={12} className="text-blue-600 dark:text-blue-400" />
                  {t("입력 설정")}
                </span>
                <button className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-black/10 dark:hover:bg-white/10 hover:text-[var(--foreground)]" onClick={() => setIsConsoleInputSettingsOpen(false)} title="Close" type="button">
                  <X size={11} />
                </button>
              </div>

              <div className="space-y-2.5 text-[10px]">
                {/* Retain input toggle */}
                <label className="flex cursor-pointer items-start gap-2 rounded bg-black/5 dark:bg-white/5 p-1.5 text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/10">
                  <input
                    aria-label={t("입력 유지")}
                    checked={isConsoleInputRetained}
                    className="mt-0.5 h-3.5 w-3.5 accent-blue-500"
                    onChange={(event) => updateConsoleInputRetained(event.target.checked)}
                    type="checkbox"
                  />
                  <div className="flex-1 leading-tight">
                    <div className="font-semibold text-[var(--foreground)]">{t("입력 유지")} ({isConsoleInputRetained ? "ON" : "OFF"})</div>
                    <div className="text-[9px] text-[var(--muted-foreground)]">{t("다음 실행 시작 시 아래 자동 입력값을 자동으로 전송합니다.")}</div>
                  </div>
                </label>

                {/* Auto input textarea */}
                <div>
                  <div className="mb-1 font-medium text-[var(--muted-foreground)]">{t("자동 입력값")}:</div>
                  <textarea
                    aria-label={t("자동 입력값")}
                    autoComplete="off"
                    className="h-16 w-full resize-y rounded border border-[var(--border)] bg-white dark:bg-black/35 px-2 py-1 font-mono text-[10px] leading-4 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/50 focus:border-blue-400/60"
                    maxLength={10_000}
                    onChange={(event) => updateConsoleAutoInput(event.target.value)}
                    placeholder={t("여러 줄 입력 가능\n각 줄은 실행 시작 시 순서대로 전송됩니다.")}
                    spellCheck={false}
                    value={consoleAutoInput}
                  />
                </div>

                {/* EOF button inside settings */}
                <div className="pt-1 border-t border-[var(--border)] flex items-center justify-between">
                  <span className="text-[9px] text-[var(--muted-foreground)]">{t("표준 입력 종료")}</span>
                  <button
                    className="rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 px-2 py-1 text-[10px] font-semibold text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!isDebugging || !hasRunSession || consoleStatus === "stopping" || consoleInputClosed || isSendingConsoleInput}
                    onClick={() => void submitConsoleInput(true)}
                    title="Close standard input (EOF)"
                    type="button"
                  >
                    {t("EOF 전송")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Stdin input bar */}
          <div className="mt-1.5 flex shrink-0 items-center gap-1.5 font-mono">
            <span className="select-none text-emerald-600 dark:text-emerald-400 font-bold">&gt;</span>
            <input
              aria-label="Program input"
              autoComplete="off"
              className="min-w-0 flex-1 rounded border border-[var(--border)] bg-white dark:bg-black/30 px-2 py-1 text-[11px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]/60 focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!isDebugging || !hasRunSession || consoleStatus === "stopping" || consoleInputClosed}
              onChange={(event) => setConsoleInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.repeat || event.nativeEvent.isComposing) return
                event.preventDefault()
                event.stopPropagation()
                void submitConsoleInput(false)
              }}
              placeholder={consoleInputClosed ? "Standard input is closed" : isDebugging ? "Type input and press Enter" : "Program is not running"}
              ref={consoleInputRef}
              spellCheck={false}
              value={consoleInput}
            />
            <button
              className="rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!isDebugging || !hasRunSession || consoleStatus === "stopping" || consoleInputClosed || isSendingConsoleInput}
              onClick={() => void submitConsoleInput(false)}
              type="button"
            >
              Send
            </button>
            <button
              aria-label={t("입력 설정")}
              className={`relative flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold transition-colors ${
                isConsoleInputSettingsOpen ? "bg-[var(--muted)] text-[var(--foreground)]" : "bg-black/5 dark:bg-white/5 text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/10"
              }`}
              onClick={() => setIsConsoleInputSettingsOpen((current) => !current)}
              title={t("입력 설정 (입력 유지, 자동 입력, EOF)")}
              type="button"
            >
              <Settings size={11} />
              <span className="font-sans">{t("입력 설정")}</span>
              {(isConsoleInputRetained || consoleAutoInput) && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          </div>
        </>
      )}

      {/* Tab 2: AI Review */}
      {bottomPanelTab === "ai_review" && (
        <div ref={aiReviewPanelRef} onWheel={handleAiReviewWheel} className="ails-code-review-content flex min-h-0 flex-1 flex-col font-sans" style={{ "--ails-code-review-font-size": `${aiReviewFontSize ?? 11}px` } as React.CSSProperties}>
          {/* Stale review banner when code has changed since last review */}
          {Boolean(aiReviewEvaluatedSignature && sandboxSourceSignature(files) !== aiReviewEvaluatedSignature) && (
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] text-amber-700 dark:text-amber-200">
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={12} className="shrink-0 text-amber-600 dark:text-amber-400" />
                <span>{t("코드 변경됨 · 다시 리뷰 필요")}</span>
              </div>
              <button
                type="button"
                onClick={() => void requestAiReview()}
                disabled={isAiReviewing}
                className="shrink-0 rounded bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-800 dark:text-amber-200 hover:bg-amber-500/30 transition-colors disabled:opacity-40"
              >
                {t("다시 리뷰")}
              </button>
            </div>
          )}

          {/* In-progress banner */}
          {isAiReviewing && (
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-800 dark:text-violet-200">
              <div className="flex items-center gap-2">
                <RefreshCw className="animate-spin text-violet-600 dark:text-violet-400" size={12} />
                <span className="font-medium">
                  {aiReviewPhase === "running"
                    ? t("코드 실행 중...")
                    : aiReviewPhase === "analyzing"
                      ? t("실행 로그 분석 중...")
                      : t("AI 코드 리뷰 중...")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void requestAiReview()}
                className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 text-[9px] font-bold text-red-700 dark:text-red-300 hover:bg-red-500/30 transition-colors"
              >
                <Square size={9} />
                <span>{t("리뷰 중지")}</span>
              </button>
            </div>
          )}

          {aiReviewPhase === "cancelled" && <div role="status" className="mb-2 text-xs text-[var(--muted-foreground)]">코드 리뷰가 취소되었습니다.</div>}
          {/* Failure card */}
          {!isAiReviewing && (aiReviewPhase === "failed" || aiReviewError) && (
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-800 dark:text-red-200">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{t("AI 코드 리뷰에 실패했습니다.")}</div>
                  <div className="text-[10px] text-red-700/80 dark:text-red-300/80 truncate">
                    {aiReviewError || aiReview?.summary || t("네트워크 또는 서버 오류가 발생했습니다.")}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void requestAiReview()}
                className="shrink-0 rounded bg-red-500/20 px-2.5 py-1 text-[10px] font-bold text-red-800 dark:text-red-200 hover:bg-red-500/30 transition-colors"
              >
                {t("다시 시도")}
              </button>
            </div>
          )}

          {/* Empty state: No review has been run */}
          {!isAiReviewing && !aiReview && !aiReviewError && (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-[var(--muted-foreground)] p-4">
              <Bot size={24} className="text-[var(--muted-foreground)]/50" />
              <div className="text-[11px] text-center font-medium text-[var(--foreground)]">
                {t("코드를 리뷰하려면 상단의 [코드 리뷰] 버튼을 누르세요.")}
              </div>
              <button
                type="button"
                onClick={() => void requestAiReview()}
                className="mt-1 flex items-center gap-1.5 rounded-md bg-[var(--brand)] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[var(--brand)]/85 transition-colors"
              >
                <Sparkles size={12} />
                <span>{t("코드 리뷰 시작")}</span>
              </button>
            </div>
          )}

          {/* Review Result */}
          {aiReview && aiReviewPhase !== "failed" && !aiReviewError && (
            <div className={`flex min-h-0 flex-1 flex-col ${aiReviewEvaluatedSignature && sandboxSourceSignature(files) !== aiReviewEvaluatedSignature ? "opacity-60" : ""}`}>
              {/* Summary header with [다시 리뷰] button */}
              <div className="mb-2 flex shrink-0 items-center justify-between gap-3 rounded border border-[var(--border)] bg-black/5 dark:bg-white/5 px-2.5 py-1.5 text-[var(--foreground)]">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Sparkles className="shrink-0 text-violet-600 dark:text-violet-300" size={13} />
                  <div className="min-w-0 flex-1 text-[11px] font-medium leading-tight">
                    {aiReview.summary}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void requestAiReview()}
                  disabled={isAiReviewing}
                  className="flex shrink-0 items-center gap-1 rounded border border-[var(--border)] bg-black/5 dark:bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--foreground)] hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-40"
                >
                  <RefreshCw size={10} />
                  <span>{t("다시 리뷰")}</span>
                </button>
              </div>

              {/* Issues list or zero issues */}
              <div className="min-h-0 flex-1 overflow-y-auto space-y-1.5 pr-1">
                {aiReview.issues.length === 0 ? (
                  <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
                    <div className="text-[12px] font-bold">{t("✓ 발견된 문제 없음")}</div>
                    <div className="text-[10px] text-emerald-600/80 dark:text-emerald-300/70">{t("작성한 코드에서 오류나 경고가 발견되지 않았습니다.")}</div>
                  </div>
                ) : (
                  aiReview.issues.map((issue, index) => (
                    <div
                      key={`${issue.file}-${issue.line}-${index}`}
                      className="rounded border border-[var(--border)] bg-white dark:bg-black/30 p-2 text-left hover:border-[var(--brand)]/50 transition-colors"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <AlertTriangle className={issueColorClass(issue.severity)} size={12} />
                          <span className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase border ${issueBadgeClass(issue.severity)}`}>
                            {issueSeverityLabel(issue.severity)}
                          </span>
                          <span className="font-mono text-[10px] text-[var(--muted-foreground)]">{issue.line}행</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--foreground)]">
                            {issue.title}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => revealIssue(issue)}
                          className="flex shrink-0 items-center gap-1 rounded bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[9px] font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-500/25 transition-colors"
                          title={t("에디터 {p0}행으로 이동", { p0: issue.line })}
                        >
                          <span>{issue.line}행으로 이동</span>
                        </button>
                      </div>
                      <div className="text-[10px] text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">
                        {issue.explanation}
                      </div>
                      {issue.fix && (
                        <div className="mt-1 text-[10px] text-violet-800 dark:text-violet-300 font-mono bg-violet-500/10 border border-violet-500/20 rounded px-1.5 py-0.5">
                          Fix: {issue.fix}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
