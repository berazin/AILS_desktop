import { IDE_ENABLED } from "../../../edition.ts"
import { PracticeWindowHeader } from "./practice-window-header.tsx"
import { PracticePdfFileButtons } from "./practice-pdf-file-buttons.tsx"
import type { PracticePdfFileControls } from "../hooks/use-practice-pdf-files.ts"
import { t } from "../../../lib/i18n.ts"
import React from "react"
import { ClipboardList, Keyboard, Layers, Play, RefreshCw, Save, Settings, Sparkles, Square, X } from "lucide-react"
import { type LanguageProfile, type PdfProblem } from "../../../lib/api"
import { CODE_SHORTCUT_DEFINITIONS, formatCodeShortcut, type CodeKeymapProfile } from "../lib/code-shortcuts.ts"
import { type SandboxFile } from "../lib/code-sandbox-support.ts"

interface CodeWindowToolbarProps {
  gradingContextControl?: React.ReactNode
  handleDragDown: (event: React.MouseEvent) => void
  documentTitle?: string
  practiceWindow: boolean
  sidebarMode: "problems" | "code"
  activeProblem: PdfProblem | null
  activeFile: SandboxFile | undefined
  baseDir: string
  displayBasePath: () => string
  projectName: string
  isDebugging: boolean
  saveStatus: "error" | "idle" | "success"
  saveMsg: string
  isSettingTemplate: boolean
  codeWorkspaceVisible: boolean
  cancelRun: () => void
  runActiveFile: (action?: "run" | "build" | "test") => Promise<unknown>
  codeShortcuts: import("../lib/code-shortcuts.ts").CodeShortcutMap
  profileAction: "run" | "test" | "build"
  activeLanguageProfile: LanguageProfile | undefined
  setProfileAction: React.Dispatch<React.SetStateAction<"run" | "test" | "build">>
  isAiReviewing: boolean
  requestAiReview: () => Promise<void>
  isSaving: boolean
  saveProject: (saveAll?: boolean) => Promise<void>
  setIsShowHelp: React.Dispatch<React.SetStateAction<boolean>>
  isShowHelp: boolean
  pdfFileControls?: PracticePdfFileControls
  keymapProfile: CodeKeymapProfile
  setIsSettingTemplate: React.Dispatch<React.SetStateAction<boolean>>
  handleCloseWindow: () => void
}

export function CodeWindowToolbar({
  gradingContextControl,
  handleDragDown,
  documentTitle,
  practiceWindow,
  sidebarMode,
  activeProblem,
  activeFile,
  baseDir,
  displayBasePath,
  projectName,
  isDebugging,
  saveStatus,
  saveMsg,
  isSettingTemplate,
  codeWorkspaceVisible,
  cancelRun,
  runActiveFile,
  codeShortcuts,
  profileAction,
  activeLanguageProfile,
  setProfileAction,
  isAiReviewing,
  requestAiReview,
  isSaving,
  saveProject,
  setIsShowHelp,
  isShowHelp,
  pdfFileControls,
  keymapProfile,
  setIsSettingTemplate,
  handleCloseWindow,
}: CodeWindowToolbarProps) {
  if (!IDE_ENABLED) return <PracticeWindowHeader title={documentTitle} onDrag={handleDragDown} onClose={handleCloseWindow}>{gradingContextControl}{pdfFileControls && <PracticePdfFileButtons controls={pdfFileControls} />}</PracticeWindowHeader>
  const controls = (
      <div
        className="ails-code-toolbar-controls flex min-w-0 flex-wrap items-center justify-end gap-2"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {saveStatus === "success" && <span className="max-w-36 truncate font-bold text-emerald-600 dark:text-emerald-400" title={saveMsg}>{saveMsg}</span>}
        {saveStatus === "error" && <span className="max-w-36 truncate font-bold text-red-600 dark:text-red-400" title={saveMsg}>{saveMsg}</span>}
        {!isSettingTemplate && codeWorkspaceVisible && activeFile && (
          isDebugging ? (
            <button className="code-sandbox-button code-sandbox-button-danger" onClick={cancelRun} type="button" title={t("실행 중지")}>
              <Square size={13} /> <span>{t("중지")}</span>
            </button>
          ) : (
            <button aria-label={t("실행")} className="code-sandbox-button code-sandbox-button-primary" onClick={() => void runActiveFile()} type="button" title={codeShortcuts.run ? `${t("실행")} (${formatCodeShortcut(codeShortcuts.run)})` : t("실행")}>
              <Play size={13} /> <span>{profileAction === "run" ? t("실행") : profileAction === "build" ? t("빌드") : t("테스트")}{codeShortcuts.run ? ` (${formatCodeShortcut(codeShortcuts.run)})` : ""}</span>
            </button>
          )
        )}
        {!isSettingTemplate && codeWorkspaceVisible && activeFile && (
          activeLanguageProfile && (activeLanguageProfile.actions || Object.keys(activeLanguageProfile.commands || {})).length > 1 && !isDebugging ? (
            <select
              aria-label={t("실행 작업")}
              className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-[10px] font-semibold text-[var(--foreground)] outline-none"
              onChange={(event) => setProfileAction(event.target.value as "run" | "build" | "test")}
              value={profileAction}
            >
              {(activeLanguageProfile.actions || Object.keys(activeLanguageProfile.commands || {})).map((action) => (
                <option key={action} value={action}>{action === "run" ? t("실행") : action === "build" ? t("빌드") : t("테스트")}</option>
              ))}
            </select>
          ) : null
        )}
        {!isSettingTemplate && codeWorkspaceVisible && activeFile && (
          isAiReviewing ? (
            <button
              className="code-sandbox-button code-sandbox-button-danger"
              onClick={() => void requestAiReview()}
              type="button"
              title={t("평가 중지")}
            >
              <Square size={13} /> <span>{t("평가 중지")}</span>
            </button>
          ) : (
            <button
              aria-label={t("코드 평가")} className="code-sandbox-button code-sandbox-button-accent"
              onClick={() => void requestAiReview()}
              type="button"
              title={t("코드 평가 (문제풀이에서 Shift 두 번)")}
            >
              <Sparkles size={13} /> <span>{t("코드 평가")}</span>
            </button>
          )
        )}
        {!isSettingTemplate && codeWorkspaceVisible && (
          <button aria-label={t("모두 저장")} className="code-sandbox-button code-sandbox-button-brand" disabled={isSaving} onClick={() => void saveProject(true)} type="button">
            {isSaving ? <RefreshCw className="animate-spin" size={13} /> : <Save size={13} />} <span>{t("모두 저장")}</span>
          </button>
        )}

        <button
          onClick={(event) => {
            event.stopPropagation()
            setIsShowHelp((current) => !current)
          }}
          className={`code-sandbox-button ${isShowHelp ? "code-sandbox-button-active" : ""}`}
          type="button"
          aria-label={t("단축키 도움말")} title={t("단축키 도움말")}
        >
          <Keyboard size={13} /> <span>{t("도움말")}</span>
        </button>
        {practiceWindow && pdfFileControls && <PracticePdfFileButtons controls={pdfFileControls} />}

        {isShowHelp && (
          <div
            className="absolute right-[160px] top-[48px] z-[95] max-h-[min(70vh,620px)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3 font-sans text-[11px] text-[var(--foreground)] shadow-2xl backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between border-b border-[var(--border)] pb-1.5 font-bold text-[var(--foreground)]">
              <span className="flex items-center gap-1.5 text-[10px]">
                <Keyboard size={12} className="text-[var(--brand)]" /> {t("단축키 도움말 (")}{keymapProfile === "vscode" ? "VS Code" : keymapProfile === "visualstudio" ? "Visual Studio" : "JetBrains"})
              </span>
              <button className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors" onClick={() => setIsShowHelp(false)} type="button">
                <X size={12} />
              </button>
            </div>
            <div className="space-y-3 text-[10px] text-[var(--foreground)]/80">
              {([t("실행 및 저장"), t("파일 및 프로젝트"), t("학습 및 AI")] as const).map((group) => (
                <div key={group}>
                  <div className="mb-1 font-bold text-[var(--brand)]">{group}</div>
                  <div className="space-y-1">
                    {CODE_SHORTCUT_DEFINITIONS.filter((definition) => t(definition.group) === group).map((definition) => (
                      <div className="flex items-center justify-between gap-3 rounded-md bg-[var(--muted)]/70 px-2 py-1" key={definition.action}>
                        <span className="min-w-0 truncate font-medium">{t(definition.label)}</span>
                        <span className="shrink-0 font-mono text-[9px] font-bold text-amber-600 dark:text-amber-400">
                          {formatCodeShortcut(codeShortcuts[definition.action])}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="border-t border-[var(--border)] pt-2 text-[9px] leading-4 text-[var(--muted-foreground)]">
                {t("F5: 실행 · Shift 두 번: AI 코드 평가 · Esc: 콘솔 닫기/문제풀이 종료")}<br />
                {t("단축키 변경: 설정 → 편집기 → 사용자 단축키")}</div>
            </div>
          </div>
        )}

        <button
          aria-label={practiceWindow ? t("문제풀이 설정") : t("코드 편집기 설정")}
          onClick={() => setIsSettingTemplate((current) => !current)}
          className={`code-sandbox-button ${isSettingTemplate ? "code-sandbox-button-active" : ""}`}
          type="button"
        >
          <Settings size={13} /> <span>{t("설정")}</span>
        </button>
        {!practiceWindow && <button className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors" onClick={handleCloseWindow} type="button" title={practiceWindow ? t("문제풀이 닫기") : t("코드 에디터 닫기")}>
          <X size={14} />
        </button>}
      </div>
  )
  if (practiceWindow) return <PracticeWindowHeader title={documentTitle} onDrag={handleDragDown} onClose={handleCloseWindow}>{gradingContextControl}{controls}</PracticeWindowHeader>
  return (
    <div
      className="ails-code-layout-border flex min-h-10 shrink-0 cursor-default flex-wrap items-center justify-between gap-2 border-b bg-[var(--practice-panel)] px-3 py-1 text-[10px] text-[var(--muted-foreground)]"
      onMouseDown={handleDragDown}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {practiceWindow && sidebarMode === "problems" ? (
          <>
            <ClipboardList size={11} className="shrink-0 text-[var(--brand)]" />
            <span className="shrink-0 text-[9px] font-bold text-[var(--brand)]">{t("문제풀이")}</span>
            {activeProblem && (
              <>
                <span className="text-[var(--muted-foreground)]/30">/</span>
                <span className="min-w-0 truncate text-[9px] font-medium text-[var(--muted-foreground)]" title={activeProblem.chapter}>
                  {activeProblem.chapter}
                </span>
                <span className="text-[var(--muted-foreground)]/30">/</span>
                <span className="shrink-0 text-[9px] font-bold text-[var(--foreground)]">
                  {activeProblem.kind === "lab" ? t("실습") : t("연습")} {activeProblem.number}{t("번")}</span>
              </>
            )}
            {activeFile && (
              <>
                <span className="text-[var(--muted-foreground)]/30">/</span>
                <span className="min-w-0 truncate font-mono text-[9px] font-bold text-[var(--foreground)]">
                  {activeFile.name}
                </span>
              </>
            )}
          </>
        ) : (
          <>
            <Layers size={10} className="text-[var(--muted-foreground)]/40 shrink-0" />
            <span className="shrink-0 text-[9px] font-bold text-[var(--brand)]">{t("코드")}</span>
            <span className="text-[9px] font-medium text-[var(--muted-foreground)] shrink-0">Save path:</span>
            {baseDir ? (
              <>
                <span className="min-w-0 truncate font-mono text-[9px] font-medium text-[var(--muted-foreground)]" title={baseDir}>
                  {displayBasePath()}
                </span>
                <span className="font-mono text-[var(--muted-foreground)]/30 shrink-0">/</span>
              </>
            ) : (
              <span className="shrink-0 text-[9px] text-[var(--muted-foreground)]/40 font-mono">...</span>
            )}
            <span className="min-w-0 truncate font-mono text-[9px] font-bold text-[var(--foreground)]">
              {activeFile ? activeFile.name : projectName}
            </span>
          </>
        )}
        {activeFile && activeFile.code !== activeFile.savedCode && (
          <span className="shrink-0 font-bold text-[9px] text-amber-600 dark:text-amber-400">
            ● {t("저장 안 됨")}
          </span>
        )}
        {isDebugging && (
          <span className="shrink-0 font-bold text-[9px] text-emerald-600 dark:text-emerald-400">
            · {t("실행 중")}
          </span>
        )}
      </div>
      {controls}
    </div>
  )
}
