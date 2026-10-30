import type { LanguageProfile } from "../../../lib/api.ts"
import type { CodeKeymapProfile } from "./code-shortcuts.ts"
import React from "react"
import * as Monaco from "monaco-editor"

import { syncCustomLanguageSyntax } from "../lib/custom-language-syntax.ts"
import { closingBraceOutdentLength, installCodeIndentation } from "../lib/code-indentation.ts"
import { ensureCodeMonacoFallbackTheme, monacoLanguageForFile, type SandboxFile } from "../lib/code-sandbox-support.ts"

interface CodeEditorMountContext {
  onSyntaxError?: (message: string) => void
  editorDisposablesRef: React.RefObject<Monaco.IDisposable[]>
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>
  monacoRef: React.RefObject<typeof Monaco | null>
  customLanguageProfiles: LanguageProfile[]
  activeFileRef: React.RefObject<SandboxFile | undefined>
  syntaxTheme: "dark-plus" | "light-plus"
  activeFile: SandboxFile | undefined
  editorFontSizeRef: React.RefObject<number>
  scheduleEditorLayout: () => void
  onKeyboardCaptureChange: ((captured: boolean) => void) | undefined
  scheduleAiIssueLineSync: () => void
  schedulePersistEditorFontSize: (next: number) => void
  adjustEditorFontSizeFromWheel: (event: WheelEvent) => void
  keymapProfile: CodeKeymapProfile
  applyAiDecorations: () => void
  applyCompilerMarkers: () => void
}

/** Owns Monaco configuration, event subscriptions and keymap installation. */
export function createCodeEditorMountHandlers(context: CodeEditorMountContext) {
  const {
    onSyntaxError,
    editorDisposablesRef,
    editorRef,
    monacoRef,
    customLanguageProfiles,
    activeFileRef,
    syntaxTheme,
    activeFile,
    editorFontSizeRef,
    scheduleEditorLayout,
    onKeyboardCaptureChange,
    scheduleAiIssueLineSync,
    schedulePersistEditorFontSize,
    adjustEditorFontSizeFromWheel,
    keymapProfile,
    applyAiDecorations,
    applyCompilerMarkers,
  } = context


  function handleEditorWillMount(monaco: typeof Monaco) {
    ensureCodeMonacoFallbackTheme(monaco)
  }


  function handleEditorDidMount(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) {
    editorDisposablesRef.current.forEach((disposable) => disposable?.dispose?.())
    editorDisposablesRef.current = []
    editorRef.current = editor
    monacoRef.current = monaco
    installCodeIndentation(monaco)
    ensureCodeMonacoFallbackTheme(monaco)
    void syncCustomLanguageSyntax(monaco, customLanguageProfiles).then(() => {
      if (editorRef.current !== editor) return
      const model = editor.getModel?.()
      const currentFile = activeFileRef.current
      if (model && currentFile) monaco.editor.setModelLanguage(model, monacoLanguageForFile(currentFile))
      monaco.editor.setTheme(syntaxTheme)
    }).catch((error) => {
      if (onSyntaxError) onSyntaxError(`구문 설정을 불러오지 못했습니다: ${String(error)}`)
      else console.error("Code syntax setup failed", error)
    })
    if (activeFile) {
      const model = editor.getModel?.()
      if (model) monaco.editor.setModelLanguage(model, monacoLanguageForFile(activeFile))
      monaco.editor.setTheme(syntaxTheme)
      editor.updateOptions?.({ fontSize: editorFontSizeRef.current })
      scheduleEditorLayout()
    }
    const editorDisposables = [
      editor.onDidDispose(() => { if (editorRef.current === editor) editorRef.current = null }),
      editor.onDidFocusEditorWidget(() => onKeyboardCaptureChange?.(true)),
      editor.onDidBlurEditorWidget(() => onKeyboardCaptureChange?.(false)),
      editor.onDidChangeModelContent((event) => {
        scheduleAiIssueLineSync()
        const lineNumbers = new Set<number>(
          (event.changes || [])
            .filter((change) => change.text === "}")
            .map((change) => change.range.startLineNumber),
        )
        if (lineNumbers.size === 0) return
        const model = editor.getModel?.()
        if (!model) return
        const language = model.getLanguageId?.() || ""
        const tabSize = Number(model.getOptions?.()?.tabSize) || 4
        const edits = [...lineNumbers].flatMap((lineNumber) => {
          const removeLength = closingBraceOutdentLength(language, model.getLineContent(lineNumber), tabSize)
          if (removeLength <= 0) return []
          return [{
            range: new monaco.Range(lineNumber, 1, lineNumber, removeLength + 1),
            text: "",
            forceMoveMarkers: true,
          }]
        })
        if (edits.length > 0) editor.executeEdits("ails.auto-outdent", edits)
      }),
      editor.onDidChangeConfiguration((event) => {
        const fontSizeOption = monaco.editor.EditorOption.fontSize
        if (!event.hasChanged?.(fontSizeOption)) return
        const nextFontSize = Number(editor.getOption?.(fontSizeOption))
        if (!Number.isFinite(nextFontSize)) return
        const clampedFontSize = Math.min(28, Math.max(9, Math.round(nextFontSize)))
        if (clampedFontSize === editorFontSizeRef.current) return
        editorFontSizeRef.current = clampedFontSize
        schedulePersistEditorFontSize(clampedFontSize)
      }),
    ]
    const editorDomNode = editor.getDomNode?.()
    if (editorDomNode) {
      editorDomNode.addEventListener("wheel", adjustEditorFontSizeFromWheel, { passive: false, capture: true })
      editorDisposables.push({
        dispose: () => editorDomNode.removeEventListener("wheel", adjustEditorFontSizeFromWheel, true),
      })
    }
    editorDisposablesRef.current = editorDisposables
    applyKeybindings(editor, monaco, keymapProfile)
    window.requestAnimationFrame(applyAiDecorations)
    window.requestAnimationFrame(applyCompilerMarkers)
  }



  return {
    handleEditorWillMount,
    handleEditorDidMount,
  }
}

export function applyKeybindings(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco, profile: string) {
  if (profile === "visualstudio") {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      editor.trigger("keyboard", "editor.action.insertLineBefore", null)
    })
  }

  if (profile === "jetbrains") {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
      editor.trigger("keyboard", "editor.action.copyLinesDownAction", null)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      editor.trigger("keyboard", "editor.action.deleteLines", null)
    })
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
      editor.trigger("keyboard", "editor.action.moveLinesUpAction", null)
    })
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
      editor.trigger("keyboard", "editor.action.moveLinesDownAction", null)
    })
    return
  }
  if (profile === "visualstudio") {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
      editor.trigger("keyboard", "editor.action.copyLinesDownAction", null)
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL, () => {
      editor.trigger("keyboard", "editor.action.deleteLines", null)
    })
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
      editor.trigger("keyboard", "editor.action.moveLinesUpAction", null)
    })
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
      editor.trigger("keyboard", "editor.action.moveLinesDownAction", null)
    })
  }

}
