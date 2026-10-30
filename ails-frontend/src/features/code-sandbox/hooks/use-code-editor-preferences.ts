import { applyKeybindings } from "../lib/code-editor-mount.ts"
import { useCodeConsoleEncoding } from "./use-code-console-encoding.ts"
import { t } from "../../../lib/i18n.ts"
import React, { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import * as Monaco from "monaco-editor"
import { findShortcutConflict, getDefaultCodeShortcuts, isCodeKeymapProfile, keyboardEventToShortcut, resolveCodeShortcuts, type CodeKeymapProfile, type CodeShortcutAction, type CodeShortcutOverridesByProfile } from "../lib/code-shortcuts.ts"
import { CODE_SANDBOX_AI_REVIEW_FONT_SIZE_KEY, CODE_SANDBOX_EDITOR_FONT_SIZE_KEY, CODE_SANDBOX_KEYMAP_KEY, CODE_SANDBOX_SHORTCUTS_KEY, CODE_SANDBOX_SETTINGS_CONTENT_FONT_SIZE_KEY, CODE_SANDBOX_SIDEBAR_LIST_FONT_SIZE_KEY, readPersistedAiReviewFontSize, readPersistedEditorFontSize, readPersistedKeymapProfile, readPersistedSettingsContentFontSize, readPersistedShortcutOverrides, readPersistedSidebarListFontSize } from "../lib/code-sandbox-support.ts"

interface CodeEditorPreferencesContext {
  allowedShortcutActions?: readonly CodeShortcutAction[]
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>
  onKeyboardCaptureChange: ((captured: boolean) => void) | undefined
  monacoRef: React.RefObject<typeof Monaco | null>
  activeFileId: string
  isOpen: boolean
  isSettingTemplate: boolean
  aiReviewVisible: boolean
}

/** Owns persisted editor keymaps, shortcut recording and bounded wheel font preferences. */
export function useCodeEditorPreferences(context: CodeEditorPreferencesContext) {
  const { consoleEncoding, changeConsoleEncoding } = useCodeConsoleEncoding()
  const {
    editorRef,
    onKeyboardCaptureChange,
    monacoRef,
    activeFileId,
    isOpen,
    isSettingTemplate,
    aiReviewVisible,
  } = context

  const [keymapProfile, setKeymapProfile] = useState<CodeKeymapProfile>(readPersistedKeymapProfile)

  const [shortcutOverridesByProfile, setShortcutOverridesByProfile] = useState<CodeShortcutOverridesByProfile>(readPersistedShortcutOverrides)

  const [recordingShortcutAction, setRecordingShortcutAction] = useState<CodeShortcutAction | null>(null)

  const [shortcutMessage, setShortcutMessage] = useState("")

  const codeShortcuts = useMemo(
    () => {
      const shortcuts = resolveCodeShortcuts(keymapProfile, shortcutOverridesByProfile[keymapProfile])
      if (context.allowedShortcutActions) for (const action of Object.keys(shortcuts) as CodeShortcutAction[]) {
        if (!context.allowedShortcutActions.includes(action)) shortcuts[action] = ""
      }
      return shortcuts
    },
    [keymapProfile, shortcutOverridesByProfile, context.allowedShortcutActions],
  )

  const changeCodeShortcutEvent = useEffectEvent((action: CodeShortcutAction, shortcut: string) =>
    changeCodeShortcut(action, shortcut),
  )

  const [sidebarListFontSize, setSidebarListFontSize] = useState(readPersistedSidebarListFontSize)

  const [aiReviewFontSize, setAiReviewFontSize] = useState(readPersistedAiReviewFontSize)

  const [settingsContentFontSize, setSettingsContentFontSize] = useState(readPersistedSettingsContentFontSize)

  const [editorFontSize, setEditorFontSize] = useState(readPersistedEditorFontSize)

  const editorFontSizeRef = useRef(editorFontSize)

  const editorFontSizeSaveTimerRef = useRef<number | null>(null)

  const sidebarPanelRef = useRef<HTMLDivElement | null>(null)

  const aiReviewPanelRef = useRef<HTMLDivElement | null>(null)

  const settingsContentRef = useRef<HTMLElement | null>(null)

  function normalizedWheelDeltaY(event: WheelEvent) {
    if (event.deltaMode === 1) return event.deltaY * 16
    if (event.deltaMode === 2) return event.deltaY * 100
    return event.deltaY
  }

  function blockNativeCtrlWheel(event: WheelEvent) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  function blockReactCtrlWheel(event: React.WheelEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.preventDefault()
    event.nativeEvent.stopPropagation()
    event.nativeEvent.stopImmediatePropagation?.()
  }

  function schedulePersistEditorFontSize(next: number) {
    if (editorFontSizeSaveTimerRef.current !== null) {
      window.clearTimeout(editorFontSizeSaveTimerRef.current)
    }
    localStorage.setItem(CODE_SANDBOX_EDITOR_FONT_SIZE_KEY, String(next))
    editorFontSizeSaveTimerRef.current = window.setTimeout(() => {
      localStorage.setItem(CODE_SANDBOX_EDITOR_FONT_SIZE_KEY, String(next))
      editorFontSizeSaveTimerRef.current = null
    }, 120)
  }

  function updateEditorFontSize(nextValue: number) {
    const next = Math.min(28, Math.max(9, Math.round(nextValue)))
    if (next === editorFontSizeRef.current) return
    editorFontSizeRef.current = next
    setEditorFontSize(next)
    editorRef.current?.updateOptions?.({ fontSize: next })
    schedulePersistEditorFontSize(next)
  }

  function adjustEditorFontSizeFromWheel(event: WheelEvent) {
    if (!(event.ctrlKey || event.metaKey)) {
      return
    }
    blockNativeCtrlWheel(event)
    const delta = normalizedWheelDeltaY(event)
    if (delta === 0) return
    updateEditorFontSize(editorFontSizeRef.current + (delta < 0 ? 1 : -1))
  }

  function adjustSidebarListFontSize(direction: number) {
    setSidebarListFontSize((current) => {
      const next = Math.min(18, Math.max(8, current + direction))
      if (next === current) return current
      localStorage.setItem(CODE_SANDBOX_SIDEBAR_LIST_FONT_SIZE_KEY, String(next))
      return next
    })
  }

  function adjustAiReviewFontSize(direction: number) {
    setAiReviewFontSize((current) => {
      const next = Math.min(22, Math.max(9, current + direction))
      if (next === current) return current
      localStorage.setItem(CODE_SANDBOX_AI_REVIEW_FONT_SIZE_KEY, String(next))
      return next
    })
  }

  function adjustSettingsContentFontSize(direction: number) {
    setSettingsContentFontSize((current) => {
      const next = Math.min(18, Math.max(10, current + direction))
      if (next === current) return current
      localStorage.setItem(CODE_SANDBOX_SETTINGS_CONTENT_FONT_SIZE_KEY, String(next))
      return next
    })
  }

  useEffect(() => {
    localStorage.setItem(CODE_SANDBOX_SIDEBAR_LIST_FONT_SIZE_KEY, String(sidebarListFontSize))
  }, [sidebarListFontSize])

  useEffect(() => {
    localStorage.setItem(CODE_SANDBOX_AI_REVIEW_FONT_SIZE_KEY, String(aiReviewFontSize))
  }, [aiReviewFontSize])

  useEffect(() => {
    localStorage.setItem(CODE_SANDBOX_SETTINGS_CONTENT_FONT_SIZE_KEY, String(settingsContentFontSize))
  }, [settingsContentFontSize])

  useEffect(() => {
    if (!recordingShortcutAction) return
    const shortcutAction = recordingShortcutAction
    onKeyboardCaptureChange?.(true)

    function captureShortcut(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()

      if (event.key === "Escape") {
        setRecordingShortcutAction(null)
        setShortcutMessage("")
        return
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        changeCodeShortcutEvent(shortcutAction, "")
        setRecordingShortcutAction(null)
        return
      }

      const shortcut = keyboardEventToShortcut(event)
      if (!shortcut) {
        setShortcutMessage(t("문자 키는 Ctrl, Alt 또는 Shift와 함께 입력하세요."))
        return
      }
      if (shortcut === "Alt+F4") {
        setShortcutMessage(t("Alt + F4는 창 닫기용 시스템 단축키라 지정할 수 없습니다."))
        return
      }
      if (changeCodeShortcutEvent(shortcutAction, shortcut)) {
        setRecordingShortcutAction(null)
      }
    }

    window.addEventListener("keydown", captureShortcut, true)
    return () => {
      window.removeEventListener("keydown", captureShortcut, true)
      onKeyboardCaptureChange?.(false)
    }
  }, [codeShortcuts, keymapProfile, onKeyboardCaptureChange, recordingShortcutAction])

  useEffect(() => {
    if (editorRef.current && monacoRef.current) applyKeybindings(editorRef.current, monacoRef.current, keymapProfile)
  }, [activeFileId, keymapProfile, editorRef, monacoRef])

  function handleSidebarWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return
    blockReactCtrlWheel(event)
    adjustSidebarListFontSize(event.deltaY < 0 ? 1 : -1)
  }

  function handleAiReviewWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!(event.ctrlKey || event.metaKey)) return
    blockReactCtrlWheel(event)
    adjustAiReviewFontSize(event.deltaY < 0 ? 1 : -1)
  }

  function handleSettingsContentWheel(event: React.WheelEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey)) return
    blockReactCtrlWheel(event)
    adjustSettingsContentFontSize(event.deltaY < 0 ? 1 : -1)
  }

  useEffect(() => {
    const node = sidebarPanelRef.current
    if (!isOpen || !node) return
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      blockNativeCtrlWheel(event)
      adjustSidebarListFontSize(event.deltaY < 0 ? 1 : -1)
    }
    node.addEventListener("wheel", handleWheel, { passive: false, capture: true })
    return () => node.removeEventListener("wheel", handleWheel, true)
  }, [isOpen, isSettingTemplate])

  useEffect(() => {
    const node = aiReviewPanelRef.current
    if (!isOpen || !node || !aiReviewVisible) return
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      blockNativeCtrlWheel(event)
      adjustAiReviewFontSize(event.deltaY < 0 ? 1 : -1)
    }
    node.addEventListener("wheel", handleWheel, { passive: false, capture: true })
    return () => node.removeEventListener("wheel", handleWheel, true)
  }, [aiReviewVisible, isOpen])

  useEffect(() => {
    const node = settingsContentRef.current
    if (!isOpen || !isSettingTemplate || !node) return
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      blockNativeCtrlWheel(event)
      adjustSettingsContentFontSize(event.deltaY < 0 ? 1 : -1)
    }
    node.addEventListener("wheel", handleWheel, { passive: false, capture: true })
    return () => node.removeEventListener("wheel", handleWheel, true)
  }, [isOpen, isSettingTemplate])

  function changeKeymapProfile(profile: string) {
    if (!isCodeKeymapProfile(profile)) return
    localStorage.setItem(CODE_SANDBOX_KEYMAP_KEY, profile)
    setKeymapProfile(profile)
    setRecordingShortcutAction(null)
    setShortcutMessage("")
  }

  function persistShortcutOverrides(next: CodeShortcutOverridesByProfile) {
    localStorage.setItem(CODE_SANDBOX_SHORTCUTS_KEY, JSON.stringify(next))
    setShortcutOverridesByProfile(next)
  }

  function changeCodeShortcut(action: CodeShortcutAction, shortcut: string): boolean {
    const conflict = findShortcutConflict(codeShortcuts, action, shortcut)
    if (conflict) {
      setShortcutMessage(t("이미 '{p0}'에 사용 중인 단축키입니다.", { p0: conflict.label }))
      return false
    }

    const defaultShortcut = getDefaultCodeShortcuts(keymapProfile)[action]
    const profileOverrides = { ...(shortcutOverridesByProfile[keymapProfile] || {}) }
    if (shortcut === defaultShortcut) delete profileOverrides[action]
    else profileOverrides[action] = shortcut
    persistShortcutOverrides({ ...shortcutOverridesByProfile, [keymapProfile]: profileOverrides })
    setShortcutMessage("")
    return true
  }

  function resetCodeShortcut(action: CodeShortcutAction) {
    const profileOverrides = { ...(shortcutOverridesByProfile[keymapProfile] || {}) }
    delete profileOverrides[action]
    persistShortcutOverrides({ ...shortcutOverridesByProfile, [keymapProfile]: profileOverrides })
    setRecordingShortcutAction(null)
    setShortcutMessage("")
  }

  function resetAllCodeShortcuts() {
    const next = { ...shortcutOverridesByProfile }
    delete next[keymapProfile]
    persistShortcutOverrides(next)
    setRecordingShortcutAction(null)
    setShortcutMessage("")
  }

  useEffect(() => () => {
    if (editorFontSizeSaveTimerRef.current !== null) {
      window.clearTimeout(editorFontSizeSaveTimerRef.current)
      localStorage.setItem(CODE_SANDBOX_EDITOR_FONT_SIZE_KEY, String(editorFontSizeRef.current))
      editorFontSizeSaveTimerRef.current = null
    }
  }, [])

  return {
    consoleEncoding,
    changeConsoleEncoding,
    editorFontSizeRef,
    codeShortcuts,
    schedulePersistEditorFontSize,
    adjustEditorFontSizeFromWheel,
    keymapProfile,
    sidebarPanelRef,
    handleSidebarWheel,
    sidebarListFontSize,
    handleSettingsContentWheel,
    settingsContentRef,
    settingsContentFontSize,
    changeKeymapProfile,
    resetAllCodeShortcuts,
    shortcutMessage,
    recordingShortcutAction,
    shortcutOverridesByProfile,
    setShortcutMessage,
    setRecordingShortcutAction,
    changeCodeShortcut,
    resetCodeShortcut,
    editorFontSize,
    updateEditorFontSize,
    adjustSidebarListFontSize,
    aiReviewFontSize,
    adjustAiReviewFontSize,
    adjustSettingsContentFontSize,
    aiReviewPanelRef,
    handleAiReviewWheel,
  }
}
