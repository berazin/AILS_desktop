import { useEffect, useRef, useState } from "react"
import Editor from "@monaco-editor/react"
import { workspaceEditorScrollbar } from "../../../shared/ui/workspace-scrollbars.ts"
import { useTheme } from "next-themes"
import { Bot, FilePlus2, Folder, HelpCircle, Play, Save, Settings, Sparkles, Square, Terminal, X } from "lucide-react"
import "../lib/monaco-loader.ts"
import { CodeExecutionResultPanel } from "../components/code-execution-result-panel.tsx"
import { CodeSettingsPanel } from "../components/code-settings-panel.tsx"
import { monacoLanguageForFile } from "../lib/code-sandbox-support.ts"
import { formatCodeShortcut, keyboardEventToShortcut, shortcutMatchesEvent, type CodeShortcutAction } from "../lib/code-shortcuts.ts"
import type { CodeWorkspace } from "./api.ts"
import { useFolderEditor } from "./use-folder-editor.ts"
import { useFolderEditorTools } from "./use-folder-editor-tools.ts"
import { FolderFilePanel } from "./folder-file-panel.tsx"
import { PanelDivider } from "../../../shared/components/panel-divider.tsx"
import { useFolderPanelSizes } from "./use-folder-panel-sizes.ts"
import { FOLDER_SHORTCUT_DEFINITIONS } from "./folder-editor-shortcuts.ts"
import { WorkspaceInputDialog } from "./workspace-input-dialog.tsx"
import { HtmlPreviewPanel } from '../../office/html-preview-panel.tsx'

const button = "flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--muted)] disabled:opacity-40"
export type FolderCodeTarget = { insert: (text: string) => boolean; file: () => string }
export function FolderEditor({ workspace, initialFile, visible, onOpenProject, onNewWorkspace, onSwitchWorkspace, onRelocate, registerTarget }: {
  workspace: CodeWorkspace; visible: boolean; onOpenProject: () => void
  onNewWorkspace?: () => void; onSwitchWorkspace?: (offset: number) => void; onRelocate?: () => void
  registerTarget?: (id: string, target: FolderCodeTarget | null) => void
  initialFile?: import("./api.ts").WorkspaceFile
}) {
  const state = useFolderEditor(workspace.id, initialFile)
  const { resolvedTheme } = useTheme()
  const tools = useFolderEditorTools(workspace, state, visible, resolvedTheme === "dark")
  const { editorRef, consoleOutputRef, current, files, activeFile, preferences, consoleState, review } = tools
  const { consoleInputRef, ...consoleProps } = consoleState
  const { sidebarPanelRef, aiReviewPanelRef, settingsContentRef, ...preferenceProps } = preferences
  const { sizes, set: setSize } = useFolderPanelSizes(workspace.id)
  const [help, setHelp] = useState(false)
  const [htmlPreview, setHtmlPreview] = useState(true)
  const [previewWidth, setPreviewWidth] = useState(420)
  const isHtml = /\.html?$/i.test(current?.path ?? '')
  const [workspaceMenu, setWorkspaceMenu] = useState(false)
  const [noticeAcknowledged, setNoticeAcknowledged] = useState(true)
  const [, setResizeHovered] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!registerTarget) return
    registerTarget(workspace.id, { insert: tools.insertOcr, file: () => state.active })
    return () => registerTarget(workspace.id, null)
  }, [registerTarget, workspace.id, tools.insertOcr, state.active])
  function shortcut(action: CodeShortcutAction) {
    const index = state.files.findIndex((file) => file.path === state.active)
    const switchFile = (offset: number) => { const next = state.files[(index + offset + state.files.length) % state.files.length]; if (next) tools.open(next.path) }
    switch (action) {
      case "run": void tools.run(); break
      case "save": void state.save(); break
      case "saveAll": void state.save(true); break
      case "newFile": tools.create(false); break
      case "newProject": onNewWorkspace?.(); break
      case "closeFile": if (!state.busy) state.close(state.active); break
      case "renameFile": if (!state.busy) tools.rename(); break
      case "nextTab": switchFile(1); break
      case "previousTab": switchFile(-1); break
      case "nextProject": onSwitchWorkspace?.(1); break
      case "previousProject": onSwitchWorkspace?.(-1); break
    }
  }
  const panelVisible = consoleProps.debugOutput.visible || review.aiReviewVisible
  return <div ref={rootRef} className="ails-folder-editor flex h-full min-h-0 flex-col bg-[var(--panel)]" data-ails-folder-editor={workspace.id}
    onKeyDownCapture={(event) => {
      if ((event.target as HTMLElement).closest("dialog")) return
      if (preferences.recordingShortcutAction || event.nativeEvent.isComposing) return
      if (event.key === "Escape") { tools.setSettingsOpen(false); setHelp(false); setWorkspaceMenu(false); return }
      if (tools.settingsOpen) return
      const matched = FOLDER_SHORTCUT_DEFINITIONS.find((item) => shortcutMatchesEvent(preferences.codeShortcuts[item.action], event.nativeEvent))
      if (matched) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) shortcut(matched.action) }
      // Preserve the folder editor's original F5 run shortcut unless it was customized/disabled.
      else if (event.key === "F5" && !event.altKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation()
        if (!event.repeat && !Object.hasOwn(preferences.shortcutOverridesByProfile[preferences.keymapProfile] || {}, "run")) void tools.run()
      } else if (["Ctrl+S", "Ctrl+W", "Ctrl+Tab", "Ctrl+Shift+Tab"].includes(keyboardEventToShortcut(event.nativeEvent) || "")) {
        event.preventDefault(); event.stopPropagation()
      }
    }}>
    <div className="relative flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-[var(--border)] px-2 py-1">
      <button className={`${button} min-w-0 flex-1`} title={workspace.path} aria-label="작업 폴더 메뉴" onClick={() => setWorkspaceMenu(!workspaceMenu)}><Folder size={14} /><span className="truncate font-semibold">{workspace.name}</span></button>
      <button className={button} onClick={() => void state.save(true)} disabled={state.busy}><Save size={13} />전체 저장</button>
      {isHtml && <button className={button} aria-pressed={htmlPreview} onClick={() => setHtmlPreview(value => !value)}>HTML 미리보기</button>}
      <select className="max-w-24 rounded bg-[var(--background)] text-xs" aria-label="코드 실행 작업" value={tools.action} onChange={(event) => tools.setAction(event.target.value as typeof tools.action)}>
        <option value="run">실행</option><option value="build">빌드</option><option value="test">테스트</option>
      </select>
      <button className={button} onClick={() => void tools.run()} disabled={!current || state.busy || review.isAiReviewing} title={formatCodeShortcut(preferences.codeShortcuts.run)}>
        {consoleProps.isDebugging ? <Square size={13} /> : <Play size={13} />} {consoleProps.isDebugging ? "중단" : "시작"}
      </button>
      <button className={button} onClick={() => void tools.requestReview(true)} disabled={!current || tools.editing || (consoleProps.isDebugging && !review.isAiReviewing)}><Bot size={13} />{review.isAiReviewing ? "리뷰 중지" : "AI 코드 리뷰"}</button>
      <button className={button} onClick={() => void tools.promptEdit()} disabled={!current || review.isAiReviewing}><Sparkles size={13} />{tools.editing ? "수정 취소" : "AI 코드 수정"}</button>
      <button className={button} aria-label="콘솔 열기" onClick={() => { tools.setBottomPanelTab("console"); consoleProps.setDebugOutput((value) => ({ ...value, visible: true })) }}><Terminal size={13} /></button>
      <button className={button} aria-label="코드 단축키 도움말" onClick={() => setHelp(!help)}><HelpCircle size={13} /></button>
      <button className={button} aria-label="코드 편집기 설정" onClick={() => tools.setSettingsOpen(true)}><Settings size={13} /></button>
      {workspaceMenu && <div role="menu" aria-label="작업 폴더 메뉴" className="absolute left-2 top-full z-50 grid rounded border border-[var(--border)] bg-[var(--panel)] p-1 shadow-xl">
        <button role="menuitem" className={button} onClick={() => { setWorkspaceMenu(false); onNewWorkspace?.() }}>새 작업 폴더</button>
        <button role="menuitem" title="Windows 파일 탐색기에서 폴더 이름을 변경하거나 이동" className={button} onClick={() => { setWorkspaceMenu(false); onRelocate?.() }}>폴더 이름 / 위치 변경</button>
        <button role="menuitem" className={button} onClick={() => { setWorkspaceMenu(false); onOpenProject() }}>프로젝트 열기</button>
      </div>}
    </div>
    {help && <div className="max-h-52 shrink-0 overflow-auto border-b border-[var(--border)] p-3 text-xs" role="region" aria-label="코드 단축키 도움말">
      <div className="mb-2 flex justify-between"><span>단축키는 설정에서 변경하거나 끌 수 있습니다.</span><button aria-label="도움말 닫기" onClick={() => setHelp(false)}><X size={12} /></button></div>
      <div className="grid grid-cols-2 gap-2">{FOLDER_SHORTCUT_DEFINITIONS.map((item) => <div key={item.action} className="flex justify-between gap-2"><span>{item.label.replace("프로젝트", "작업 폴더")}</span><kbd>{formatCodeShortcut(preferences.codeShortcuts[item.action])}</kbd></div>)}</div>
    </div>}
    {state.error && <div className="flex items-center gap-2 bg-red-500/10 px-3 py-2 text-xs text-red-600" role="alert"><span className="min-w-0 flex-1 break-words">{state.error}</span>
      {current && <button className={button} onClick={() => void state.open(current.path, true)}>다시 불러오기</button>}<button aria-label="오류 닫기" onClick={() => state.setError("")}><X size={12} /></button></div>}
    <div className="flex min-h-0 flex-1">
      <FolderFilePanel workspace={workspace} state={state} onOpen={tools.open} onCreate={tools.create} onRename={tools.rename}
        onOpenProject={onOpenProject} panelRef={sidebarPanelRef} fontSize={preferenceProps.sidebarListFontSize}
        width={sizes.sidebar} onResize={(value) => setSize("sidebar", value)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex min-h-8 shrink-0 overflow-x-auto border-b border-[var(--border)]">
          {state.files.map((file) => <div key={file.path} className={`flex shrink-0 items-center border-r ${state.active === file.path ? "bg-[var(--brand-soft)]" : ""}`}
            style={{ borderRightColor: "color-mix(in srgb, var(--muted-foreground) 55%, var(--border))" }}>
            <button className="px-3 py-2 text-xs" title={file.path} onClick={() => tools.open(file.path)}>{file.path.split("/").at(-1)}{file.text !== file.draft ? " ●" : ""}</button>
            <button aria-label={`${file.path} 탭 닫기`} className="pr-2" disabled={state.busy} onClick={() => state.close(file.path)}><X size={11} /></button>
          </div>)}
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1">
          {current && activeFile ? <Editor key={`${current.path}:${current.reloadCount ?? 0}:${preferences.keymapProfile}`} path={`ails-workspace://${workspace.id}/${current.path}`} defaultValue={current.draft}
            language={monacoLanguageForFile(activeFile)} theme={tools.syntaxTheme} beforeMount={tools.beforeMount} onMount={tools.onMount}
            options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: preferenceProps.editorFontSize, tabSize: 4, scrollBeyondLastLine: false,
              wordWrap: "on", glyphMargin: true, formatOnPaste: true, formatOnType: true, autoIndent: "full", padding: { top: 8 }, scrollbar: workspaceEditorScrollbar }}
            onChange={(value) => state.update(current.path, value ?? "", editorRef.current?.saveViewState(), current.reloadCount ?? 0)} />
            : <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[var(--muted-foreground)]"><FilePlus2 size={28} /><p>파일을 선택하거나 새 파일을 만드세요.</p><button className={button} onClick={() => tools.create(false)}>새 파일 만들기</button></div>}
          </div>
          {isHtml && htmlPreview && current && <>
            <PanelDivider vertical reverse label="HTML 미리보기 너비" value={previewWidth} onChange={value => setPreviewWidth(Math.min(900, Math.max(180, value)))} />
            <div style={{ width: previewWidth, maxWidth: '65%' }} className="min-w-0 shrink-0"><HtmlPreviewPanel path={`${workspace.path}/${current.path}`} source={current.draft} /></div>
          </>}
        </div>
        {panelVisible && <>
          <PanelDivider label={tools.bottomPanelTab === "console" ? "콘솔 크기" : "코드 리뷰 크기"} value={sizes[tools.bottomPanelTab === "console" ? "console" : "review"]} onChange={(value) => setSize(tools.bottomPanelTab === "console" ? "console" : "review", value)} />
          <CodeExecutionResultPanel {...consoleProps} {...review} activeFile={activeFile} files={files} projectName={workspace.name}
            compilerDiagnostics={tools.compilerDiagnostics} revealLine={tools.revealLine} revealIssue={tools.revealIssue} requestAiReview={() => tools.requestReview()}
            consoleInputRef={consoleInputRef} consoleOutputRef={consoleOutputRef} aiReviewPanelRef={aiReviewPanelRef} aiReviewFontSize={preferenceProps.aiReviewFontSize}
            handleAiReviewWheel={preferenceProps.handleAiReviewWheel} setBottomPanelTab={tools.setBottomPanelTab} bottomPanelTab={tools.bottomPanelTab}
            hasRunSession={Boolean(consoleProps.runSessionId)} consoleHeight={sizes[tools.bottomPanelTab === "console" ? "console" : "review"]} maxHeight="55%"
            isConsoleResizeHovered={false} isConsoleResizing={false} setIsConsoleResizeHovered={setResizeHovered} handleConsoleBorderMouseDown={() => {}} handleConsoleBorderMouseMove={() => {}}
            firstRunNoticeAcknowledged={noticeAcknowledged} setFirstRunNoticeAcknowledged={setNoticeAcknowledged} />
        </>}
      </div>
    </div>
    <div className="flex min-h-6 shrink-0 justify-between gap-2 border-t border-[var(--border)] px-3 py-1 text-[10px] text-[var(--muted-foreground)]" role="status">
      <span className="truncate">{state.busy ? "저장 중…" : state.status || (state.files.some((file) => file.text !== file.draft) ? "저장하지 않은 변경 있음" : "모든 변경 사항 저장됨")}</span><span>{activeFile?.language}</span>
    </div>
    {tools.settingsOpen && <CodeSettingsPanel {...preferenceProps} settingsContentRef={settingsContentRef} folderMode applyTemplate={current ? tools.applyTemplate : undefined}
      settingsTab={tools.settingsTab} setSettingsTab={tools.setSettingsTab} setIsSettingTemplate={tools.setSettingsOpen}
      settingLanguage={tools.settingLanguage} setSettingLanguage={tools.setSettingLanguage} customLanguageProfiles={tools.customLanguageProfiles}
      applyCustomLanguageProfiles={tools.setCustomLanguageProfiles} customTemplateText={tools.customTemplateText} setCustomTemplateText={tools.setCustomTemplateText}
      saveCustomTemplate={tools.saveCustomTemplate} templateSaveOk={tools.templateSaveOk} />}
    <WorkspaceInputDialog input={tools.input} />
  </div>
}
