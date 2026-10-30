import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react"
import type * as Monaco from "monaco-editor"
import { DEVELOPER_TOOLS_ENABLED } from "../../../edition.ts"
import { getLanguageProfiles, promptEditCodeSandbox, type CodeReviewIssue, type LanguageProfile } from "../../../lib/api.ts"
import { useCodeAiReview } from "../hooks/use-code-ai-review.ts"
import { useCodeExecutionConsole } from "../hooks/use-code-execution-console.ts"
import { useCodeEditorPreferences } from "../hooks/use-code-editor-preferences.ts"
import { useCodeEditorAnnotations } from "../hooks/use-code-editor-annotations.ts"
import { createCodeEditorMountHandlers } from "../lib/code-editor-mount.ts"
import { detectLanguageFromExtension, getLanguageTemplate, fallbackTemplate, readPersistedTemplate, sandboxSourceSignature, trimExtractedCodeBlock, writePersistedTemplate, type CodeRunSnapshot } from "../lib/code-sandbox-support.ts"
import type { CompilerDiagnostic } from "../lib/compiler-diagnostics.ts"
import { syncCustomLanguageSyntax } from "../lib/custom-language-syntax.ts"
import { FOLDER_SHORTCUT_ACTIONS } from "./folder-editor-shortcuts.ts"
import type { CodeWorkspace } from "./api.ts"
import type { useFolderEditor } from "./use-folder-editor.ts"
import { useWorkspaceInput } from "./use-workspace-input.ts"

export function useFolderEditorTools(workspace: CodeWorkspace, state: ReturnType<typeof useFolderEditor>, visible: boolean, dark: boolean) {
  const workspaceInput = useWorkspaceInput()
  const { setError } = state
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const [action, setAction] = useState<"run" | "build" | "test">("run")
  const [bottomPanelTab, setBottomPanelTab] = useState<"console" | "ai_review">("console")
  const [diagnostics, setDiagnostics] = useState<CompilerDiagnostic[]>([])
  const [customLanguageProfiles, setCustomLanguageProfiles] = useState<LanguageProfile[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<"editor" | "templates" | "toolchains" | "languages">("editor")
  const [settingLanguage, setSettingLanguage] = useState("python")
  const [customTemplateText, setCustomTemplateText] = useState("")
  const [templateSaveOk, setTemplateSaveOk] = useState(false)
  const [editing, setEditing] = useState(false)
  const editAbort = useRef<AbortController | null>(null)
  const consoleOutputRef = useRef<HTMLDivElement | null>(null)
  const runRef = useRef<CodeRunSnapshot | null>(null)
  const navigation = useRef<{ path: string; line: number; column: number } | null>(null)
  const current = state.files.find((file) => file.path === state.active)
  const files = useMemo(() => state.files.map((file) => ({ id: file.path, name: file.path, code: file.draft, savedCode: file.text,
    language: detectLanguageFromExtension(file.path, customLanguageProfiles) })), [state.files, customLanguageProfiles])
  const activeFile = files.find((file) => file.id === state.active)
  const activeFileRef = useRef(activeFile)
  useLayoutEffect(() => { activeFileRef.current = activeFile }, [activeFile])
  const consoleState = useCodeExecutionConsole({ activeFile, files, baseDir: "workspace", projectName: workspace.id, workspaceId: workspace.id, diagnosticRoot: workspace.path,
    profileAction: action, lastProblemRunRef: runRef, setBottomPanelTab, setCompilerDiagnostics: setDiagnostics })
  const review = useCodeAiReview({ baseDir: "workspace", projectName: workspace.name, scopeKey: `workspace:${workspace.id}`, includeNestedFiles: true,
    codeWorkspaceVisible: visible, activeFile, files, lastProblemRunRef: runRef, setBottomPanelTab, recordActiveProblemHint: () => {},
    setLastRunElapsed: consoleState.setLastRunElapsed, setDebugOutput: consoleState.setDebugOutput,
    runBeforeReview: async (signal) => {
      if (!await state.save(true)) throw new Error("파일을 저장하지 못했습니다. 오류를 확인하고 다시 리뷰하세요.")
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError")
      const result = await consoleState.runActiveFile("run", signal)
      if (!result) throw new Error("실행을 먼저 마친 뒤 리뷰하세요.")
      return result
    },
  })
  const preferences = useCodeEditorPreferences({ editorRef, monacoRef, activeFileId: state.active, isOpen: visible,
    isSettingTemplate: settingsOpen, aiReviewVisible: review.aiReviewVisible && bottomPanelTab === "ai_review",
    onKeyboardCaptureChange: undefined, allowedShortcutActions: FOLDER_SHORTCUT_ACTIONS })
  const syntaxTheme = dark ? "dark-plus" : "light-plus"
  const compilerDiagnostics = diagnostics.map((item) => ({ ...item, file: relativePath(item.file) }))
  const annotations = useCodeEditorAnnotations({ ...review, editorRef, monacoRef, activeFile, files, activeFileRef,
    activeFileId: state.active, compilerDiagnostics, customLanguageProfiles, syntaxTheme, syncModel: false, exactDiagnosticPaths: true,
    setActiveFileId: (value) => { if (typeof value === "string") void state.open(value) },
    aiReviewHeight: 0, consoleHeight: 0, size: { width: 0, height: 0 }, debugOutput: consoleState.debugOutput })
  const mount = createCodeEditorMountHandlers({ ...annotations, onSyntaxError: setError, editorRef, monacoRef, activeFile, activeFileRef, syntaxTheme, customLanguageProfiles,
    editorFontSizeRef: preferences.editorFontSizeRef, keymapProfile: preferences.keymapProfile,
    adjustEditorFontSizeFromWheel: preferences.adjustEditorFontSizeFromWheel, schedulePersistEditorFontSize: preferences.schedulePersistEditorFontSize,
    onKeyboardCaptureChange: undefined })

  useEffect(() => {
    if (!DEVELOPER_TOOLS_ENABLED) return
    let cancelled = false
    getLanguageProfiles().then((result) => { if (!cancelled) setCustomLanguageProfiles(result.profiles) })
      .catch((error) => { if (!cancelled) setError(`언어 설정을 불러오지 못했습니다: ${String(error)}`) })
    return () => { cancelled = true }
  }, [setError])
  useEffect(() => {
    setCustomTemplateText(readPersistedTemplate(settingLanguage) ?? customLanguageProfiles.find((profile) => profile.id === settingLanguage)?.template ?? fallbackTemplate(settingLanguage))
    setTemplateSaveOk(false)
  }, [settingLanguage, customLanguageProfiles])
  useEffect(() => () => { editAbort.current?.abort() }, [])
  useEffect(() => {
    if (visible) editorRef.current?.layout()
    else setSettingsOpen(false)
  }, [visible])
  useEffect(() => {
    const node = consoleOutputRef.current
    if (node && bottomPanelTab === "console") node.scrollTop = node.scrollHeight
  }, [consoleState.debugOutput, bottomPanelTab])
  useEffect(() => {
    const monaco = monacoRef.current
    if (monaco) void syncCustomLanguageSyntax(monaco, customLanguageProfiles).catch((error) => setError(String(error)))
  }, [customLanguageProfiles, setError])

  function relativePath(path: string) {
    const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "")
    const root = workspace.path.replace(/\\/g, "/").replace(/\/$/, "") + "/"
    return normalized.toLowerCase().startsWith(root.toLowerCase()) ? normalized.slice(root.length) : normalized
  }
  function revealPending() {
    const target = navigation.current, editor = editorRef.current, model = editor?.getModel()
    if (!target || !editor || !model || activeFileRef.current?.name !== target.path || model.uri.path !== `/${target.path}`) return
    const lineNumber = Math.max(1, Math.min(target.line, model.getLineCount()))
    editor.setPosition({ lineNumber, column: Math.max(1, Math.min(target.column, model.getLineMaxColumn(lineNumber))) })
    editor.revealLineInCenter(lineNumber); editor.focus(); navigation.current = null
  }
  const revealPendingEvent = useEffectEvent(revealPending)
  useEffect(() => { revealPendingEvent() }, [state.active])
  function revealLine(path?: string, line = 1, column = 1) {
    const name = relativePath(path || state.active)
    if (!name || /^(\/|[A-Za-z]:)|(^|\/)\.\.(\/|$)/.test(name)) { setError("작업 폴더 밖의 진단 파일은 열 수 없습니다."); return }
    navigation.current = { path: name, line, column }
    rememberView()
    void state.open(name).then(() => requestAnimationFrame(revealPending))
  }
  function rememberView() {
    const editor = editorRef.current
    if (current && editor?.getModel()?.uri.path === `/${current.path}`) state.update(current.path, editor.getValue(), editor.saveViewState(), current.reloadCount ?? 0)
  }
  function open(path: string) { rememberView(); void state.open(path) }
  async function rename(path = state.active, directory = false) {
    if (!path) return
    rememberView()
    const name = await workspaceInput.request({ title: "새 상대 경로", initialValue: path })
    if (name && name !== path) void state.mutate("rename", path, name, directory)
  }
  async function create(directory: boolean, parent = state.active.split("/").slice(0, -1).join("/")) {
    const name = await workspaceInput.request({ title: directory ? "새 폴더 이름" : "새 파일 이름", initialValue: directory ? "" : "main.py" })
    if (name) { rememberView(); void state.mutate("create", parent ? `${parent}/${name}` : name, "", directory, directory ? "" : getLanguageTemplate(name, customLanguageProfiles)) }
  }
  async function run() {
    if (consoleState.isDebugging) { consoleState.cancelRun(); return }
    if (review.isAiReviewing) return
    rememberView()
    if (await state.save(true)) await consoleState.runActiveFile(action)
  }
  async function requestReview(reuse = false) {
    if (consoleState.isDebugging && !review.isAiReviewing) return
    if (reuse && !review.isAiReviewing && review.aiReview && review.aiReviewPhase === "completed"
      && review.aiReviewEvaluatedSignature === sandboxSourceSignature(files)) {
      setBottomPanelTab("ai_review"); review.setAiReviewVisibleForScope(review.aiReviewScope, true); return
    }
    await review.requestAiReview()
  }
  function replaceCode(path: string, text: string, source: string) {
    const editor = editorRef.current, model = editor?.getModel()
    if (editor && model && activeFileRef.current?.name === path) {
      editor.pushUndoStop(); editor.executeEdits(source, [{ range: model.getFullModelRange(), text }]); editor.pushUndoStop()
    } else state.replaceDraft(path, text)
  }
  async function promptEdit() {
    if (editing) { editAbort.current?.abort(); return }
    if (!activeFile) return
    const instruction = await workspaceInput.request({ title: "AI에게 요청할 코드 수정 내용을 입력하세요." })
    if (!instruction) return
    const controller = new AbortController()
    editAbort.current = controller; setEditing(true)
    state.setStatus("AI가 코드를 수정하고 있습니다…")
    try {
      const result = await promptEditCodeSandbox({ file_name: activeFile.name, language: activeFile.language, code: activeFile.code,
        files: files.map((file) => ({ name: file.name, code: file.code })), instruction }, controller.signal)
      if (controller.signal.aborted) return
      if (typeof result.code !== "string") throw new Error("AI 수정 결과가 올바르지 않습니다.")
      const target = state.getFile(activeFile.name)
      if (!target) { setError("수정 대상 파일이 닫히거나 이동되었습니다. 다시 요청하세요."); return }
      if (target.draft !== activeFile.code && !confirm("AI 요청 이후 파일이 변경되었습니다. 현재 내용을 AI 수정 결과로 바꿀까요?")) return
      replaceCode(activeFile.name, result.code, "ails.prompt-edit")
      state.setStatus("AI 수정 완료 · 저장 전 내용을 확인하세요.")
    } catch (error) { if (!controller.signal.aborted) setError(`AI 수정 실패: ${String(error)}`) }
    finally { if (editAbort.current === controller) { editAbort.current = null; setEditing(false); if (controller.signal.aborted) state.setStatus("AI 수정 취소됨") } }
  }
  function insertOcr(text: string) {
    const editor = editorRef.current, model = editor?.getModel()
    const snippet = trimExtractedCodeBlock(text)
    if (!editor || !model || !activeFileRef.current || !snippet.trim()) return false
    const range = editor.getSelection()
    if (!range) return false
    editor.pushUndoStop(); editor.executeEdits("pdf-region-ocr", [{ range, text: snippet, forceMoveMarkers: true }]); editor.pushUndoStop()
    editor.focus(); state.setStatus("PDF 텍스트 삽입됨 · 저장 전 내용을 확인하세요.")
    return true
  }
  function saveCustomTemplate() { writePersistedTemplate(settingLanguage, customTemplateText); setTemplateSaveOk(true) }
  function applyTemplate() {
    if (!current) return
    if (current.draft.trim() && !confirm("현재 파일 내용을 템플릿으로 바꿀까요?")) return
    replaceCode(current.path, customTemplateText, "ails.template"); setSettingsOpen(false)
  }
  function onMount(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) {
    if (current && editor.getValue() !== current.draft) editor.setValue(current.draft)
    mount.handleEditorDidMount(editor, monaco)
    if (current?.viewState) editor.restoreViewState(current.viewState as Monaco.editor.ICodeEditorViewState)
    revealPending()
  }
  return { editorRef, current, files, activeFile, action, setAction, bottomPanelTab, setBottomPanelTab, compilerDiagnostics, consoleState, review,
    preferences, settingsOpen, setSettingsOpen, settingsTab, setSettingsTab, settingLanguage, setSettingLanguage, customLanguageProfiles,
    setCustomLanguageProfiles, customTemplateText, setCustomTemplateText, templateSaveOk, saveCustomTemplate, applyTemplate,
    input: workspaceInput.input, editing, promptEdit, requestReview, run, create, rename, open, rememberView, insertOcr, onMount, beforeMount: mount.handleEditorWillMount,
    revealLine, revealIssue: (issue: CodeReviewIssue) => revealLine(issue.file, issue.line, issue.column), consoleOutputRef, syntaxTheme }
}
