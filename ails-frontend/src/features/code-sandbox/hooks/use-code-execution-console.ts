import type React from "react"
import { useCodeConsoleEncoding } from "./use-code-console-encoding.ts"
import { startCodeSandboxSession, streamCodeSandboxSession, stopCodeSandboxSession } from "../../../lib/api.ts"
import { parseCompilerDiagnostics, type CompilerDiagnostic } from "../lib/compiler-diagnostics.ts"
import { sandboxSourceSignature, isTerminalConsoleStatus, type SandboxFile, type CodeRunSnapshot } from "../lib/code-sandbox-support.ts"
import { useCallback, useEffect, useEffectEvent, useRef, useState, type MutableRefObject } from "react"

import { sendCodeSandboxInput } from "../../../lib/api.ts"
import {
  appendConsoleTail,
  CONSOLE_STREAM_CHARACTER_LIMIT,
  consoleErrorMessage,
  readPersistedConsoleInputSettings,
  writePersistedConsoleInputSettings,
  type ConsoleStatus,
} from "../lib/code-sandbox-support.ts"

type ConsoleOutput = { stdout: string; stderr: string; visible: boolean }

export function useCodeExecutionConsole({
  activeFile,
  files,
  profileAction,
  lastProblemRunRef,
  setBottomPanelTab,
  setCompilerDiagnostics,
  baseDir,
  projectName,
  workspaceId,
  diagnosticRoot,
}: {
  activeFile: SandboxFile | undefined
  files: SandboxFile[]
  profileAction: "run" | "build" | "test"
  lastProblemRunRef: MutableRefObject<CodeRunSnapshot | null>
  setBottomPanelTab: React.Dispatch<React.SetStateAction<"console" | "ai_review">>
  setCompilerDiagnostics: React.Dispatch<React.SetStateAction<CompilerDiagnostic[]>>
  baseDir: string
  projectName: string
  workspaceId?: string
  diagnosticRoot?: string
}) {
  const activeFileName = activeFile?.name || ""
  const { consoleEncoding } = useCodeConsoleEncoding()


  const [isDebugging, setIsDebugging] = useState(false)

  const [lastRunElapsed, setLastRunElapsed] = useState<string | null>(null)

  const runAbortRef = useRef<AbortController | null>(null)

  const runSessionRef = useRef<string | null>(null)

  const [runSessionId, setRunSessionId] = useState<string | null>(null)
  const [debugOutput, setDebugOutput] = useState<ConsoleOutput>({ stdout: "", stderr: "", visible: false })
  const [consoleStatus, setConsoleStatus] = useState<ConsoleStatus>("idle")
  const [consoleReturnCode, setConsoleReturnCode] = useState<number | null>(null)
  const [consoleTruncated, setConsoleTruncated] = useState(false)
  const [consoleInput, setConsoleInput] = useState("")
  const [consoleInputClosed, setConsoleInputClosed] = useState(false)
  const [isConsoleInputRetained, setIsConsoleInputRetained] = useState(false)
  const [consoleAutoInput, setConsoleAutoInput] = useState("")
  const [isConsoleInputSettingsOpen, setIsConsoleInputSettingsOpen] = useState(false)
  const [isSendingConsoleInput, setIsSendingConsoleInput] = useState(false)
  const isSendingConsoleInputRef = useRef(false)
  const consoleInputRef = useRef<HTMLInputElement | null>(null)
  const consoleCharacterCountsRef = useRef({ stdout: 0, stderr: 0 })

  useEffect(() => {
    const settings = activeFileName
      ? readPersistedConsoleInputSettings(baseDir, projectName, activeFileName)
      : { retained: false, input: "" }
    setIsConsoleInputRetained(settings.retained)
    setConsoleAutoInput(settings.input)
    setIsConsoleInputSettingsOpen(false)
  }, [activeFileName, baseDir, projectName])

  const appendLiveConsoleError = useCallback((errorText: string) => {
    const stderrCharacterCount = consoleCharacterCountsRef.current.stderr + errorText.length
    consoleCharacterCountsRef.current.stderr = Math.min(CONSOLE_STREAM_CHARACTER_LIMIT, stderrCharacterCount)
    setConsoleTruncated((current) => current || stderrCharacterCount > CONSOLE_STREAM_CHARACTER_LIMIT)
    setDebugOutput((current) => ({
      ...current,
      stderr: appendConsoleTail(current.stderr, errorText),
      visible: true,
    }))
  }, [])

  const appendLiveConsoleInputEcho = useCallback((inputText: string) => {
    const stdoutCharacterCount = consoleCharacterCountsRef.current.stdout + inputText.length
    consoleCharacterCountsRef.current.stdout = Math.min(CONSOLE_STREAM_CHARACTER_LIMIT, stdoutCharacterCount)
    setConsoleTruncated((current) => current || stdoutCharacterCount > CONSOLE_STREAM_CHARACTER_LIMIT)
    setDebugOutput((current) => ({
      ...current,
      stdout: appendConsoleTail(current.stdout, inputText),
      visible: true,
    }))
  }, [])

  const appendStreamedConsoleOutput = useCallback((stdout: string, stderr: string, truncated = false) => {
    const stdoutCharacterCount = consoleCharacterCountsRef.current.stdout + stdout.length
    const stderrCharacterCount = consoleCharacterCountsRef.current.stderr + stderr.length
    consoleCharacterCountsRef.current = {
      stdout: Math.min(CONSOLE_STREAM_CHARACTER_LIMIT, stdoutCharacterCount),
      stderr: Math.min(CONSOLE_STREAM_CHARACTER_LIMIT, stderrCharacterCount),
    }
    setDebugOutput((current) => ({
      stdout: appendConsoleTail(current.stdout, stdout),
      stderr: appendConsoleTail(current.stderr, stderr),
      visible: true,
    }))
    setConsoleTruncated((current) => (
      current
      || truncated
      || stdoutCharacterCount > CONSOLE_STREAM_CHARACTER_LIMIT
      || stderrCharacterCount > CONSOLE_STREAM_CHARACTER_LIMIT
    ))
  }, [])

  const focusConsoleInputAtEnd = useCallback(() => {
    window.requestAnimationFrame(() => {
      const input = consoleInputRef.current
      if (!input || input.disabled) return
      input.focus({ preventScroll: true })
      const caret = input.value.length
      input.setSelectionRange(caret, caret)
    })
  }, [])

  const updateConsoleInputRetained = useCallback((retained: boolean) => {
    setIsConsoleInputRetained(retained)
    if (!activeFileName) return
    writePersistedConsoleInputSettings(baseDir, projectName, activeFileName, {
      retained,
      input: consoleAutoInput,
    })
  }, [activeFileName, baseDir, consoleAutoInput, projectName])

  const updateConsoleAutoInput = useCallback((input: string) => {
    setConsoleAutoInput(input)
    if (!activeFileName) return
    writePersistedConsoleInputSettings(baseDir, projectName, activeFileName, {
      retained: isConsoleInputRetained,
      input,
    })
  }, [activeFileName, baseDir, isConsoleInputRetained, projectName])

  const resetForRun = useCallback(() => {
    setConsoleReturnCode(null)
    setConsoleTruncated(false)
    setConsoleInput("")
    setConsoleInputClosed(false)
    setIsConsoleInputSettingsOpen(false)
    consoleCharacterCountsRef.current = { stdout: 0, stderr: 0 }
    setDebugOutput({ stdout: "", stderr: "", visible: true })
  }, [])

  const getAutomaticInput = useCallback(() => {
    if (!activeFileName) return ""
    const settings = readPersistedConsoleInputSettings(baseDir, projectName, activeFileName)
    if (!settings.retained || settings.input === "") return ""
    return settings.input.endsWith("\n") ? settings.input : `${settings.input}\n`
  }, [activeFileName, baseDir, projectName])

  const submitConsoleInput = useCallback(async (eof = false) => {
    const sessionId = runSessionRef.current
    if (!sessionId || !isDebugging || isSendingConsoleInputRef.current) return
    const input = eof ? "" : `${consoleInput}\n`
    isSendingConsoleInputRef.current = true
    setIsSendingConsoleInput(true)
    if (!eof) {
      setConsoleInput("")
      focusConsoleInputAtEnd()
    }
    try {
      const result = await sendCodeSandboxInput(sessionId, input, eof)
      if (!result.success) throw new Error(result.error || "Input was rejected")
      const consoleEcho = eof ? "\n[EOF sent]\n" : input
      appendLiveConsoleInputEcho(consoleEcho)
      setConsoleStatus(result.status)
      if (eof) {
        setConsoleInput("")
        setConsoleInputClosed(true)
      }
    } catch (error: unknown) {
      if (!eof) setConsoleInput((current) => current || input.slice(0, -1))
      appendLiveConsoleError(`[Input failed] ${consoleErrorMessage(error, "Network error")}\n`)
    } finally {
      isSendingConsoleInputRef.current = false
      setIsSendingConsoleInput(false)
      if (!eof) focusConsoleInputAtEnd()
    }
  }, [appendLiveConsoleError, appendLiveConsoleInputEcho, consoleInput, focusConsoleInputAtEnd, isDebugging, runSessionRef])

  const resetConsoleForRun = resetForRun


  async function runActiveFile(action: "run" | "build" | "test" = profileAction, signal?: AbortSignal) {
    if (runAbortRef.current) {
      cancelRun()
      return
    }
    if (!activeFile) return
    const startTime = Date.now()
    if (!signal) setBottomPanelTab("console")
    setLastRunElapsed(null)
    const runSignature = sandboxSourceSignature(files)
    let capturedStdout = ""
    let capturedStderr = ""
    let capturedReturnCode: number | null = null
    let capturedStatus: ConsoleStatus | undefined
    const controller = new AbortController()
    const abort = () => { stopRun(); controller.abort() }
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) controller.abort()
    runAbortRef.current = controller
    runSessionRef.current = null
    setRunSessionId(null)
    setIsDebugging(true)
    setConsoleStatus("starting")
    resetConsoleForRun()
    setCompilerDiagnostics([])
    const automaticInput = getAutomaticInput()
    try {
      if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError")
      const started = await startCodeSandboxSession(
        {
          code: activeFile.code,
          console_encoding: consoleEncoding,
          workspace_id: workspaceId,
          language: activeFile.language,
          file_name: activeFile.name,
          files: files.map((file) => ({ name: file.name, code: file.code })),
          stdin: automaticInput,
          timeout: 30,
          action,
        },
        // Let startup return its session ID so cancellation can stop the process even
        // when the user cancels during compilation or closes the folder tab.
        undefined,
      )
      const nextCompilerDiagnostics = parseCompilerDiagnostics(
        started.success ? started.diagnostics : (started.diagnostics || started.stderr || started.error),
        activeFile.name,
        diagnosticRoot,
      )
      setCompilerDiagnostics(nextCompilerDiagnostics)
      if (!started.success) {
        capturedStderr = String(started.diagnostics || started.stderr || started.error || "")
        if (capturedStderr) appendLiveConsoleError(`${capturedStderr}\n`)
        throw new Error(
          nextCompilerDiagnostics.length > 0
            ? "Compilation failed. See editor diagnostics."
            : (started.error || "Could not start the program"),
        )
      }

      const sessionId = started.session_id
      if (controller.signal.aborted) {
        void stopCodeSandboxSession(sessionId).catch(() => undefined)
        throw new DOMException("Stopped", "AbortError")
      }
      runSessionRef.current = sessionId
      setRunSessionId(sessionId)
      let stdoutOffset = started.stdout_offset || 0
      let stderrOffset = started.stderr_offset || 0
      setConsoleStatus(started.status)
      capturedStatus = started.status
      if (automaticInput) appendLiveConsoleInputEcho(automaticInput)

      while (!controller.signal.aborted) {
        const streamed = await streamCodeSandboxSession(
          sessionId,
          stdoutOffset,
          stderrOffset,
          controller.signal,
        )
        if (!streamed.success) throw new Error(streamed.error || "Could not read program output")
        if (runSessionRef.current !== sessionId) return

        stdoutOffset = streamed.stdout_offset
        stderrOffset = streamed.stderr_offset
        appendStreamedConsoleOutput(streamed.stdout || "", streamed.stderr || "", streamed.truncated)
        setConsoleStatus(streamed.status)
        setConsoleReturnCode(streamed.returncode)
        capturedStdout = appendConsoleTail(capturedStdout, streamed.stdout || "")
        capturedStderr = appendConsoleTail(capturedStderr, streamed.stderr || "")
        capturedStatus = streamed.status
        capturedReturnCode = streamed.returncode
        if (isTerminalConsoleStatus(streamed.status) && !streamed.more_output) break
      }
    } catch (error: unknown) {
      const cancelled = controller.signal.aborted
      const stderr = cancelled ? "[Stopped]\n" : `[Run failed]\n${consoleErrorMessage(error, "Network error")}\n`
      capturedStatus = cancelled ? "stopped" : "failed"
      capturedStderr = appendConsoleTail(capturedStderr, stderr)
      setConsoleStatus(capturedStatus)
      appendLiveConsoleError(stderr)
    } finally {
      signal?.removeEventListener("abort", abort)
      if (capturedStatus && capturedStatus !== "stopped") {
        lastProblemRunRef.current = {
          signature: runSignature,
          consoleEncoding,
          action,
          success: capturedStatus === "exited" ? capturedReturnCode === 0 : false,
          returncode: capturedReturnCode,
          stdout: capturedStdout,
          stderr: capturedStderr,
          status: capturedStatus,
        }
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      setLastRunElapsed(elapsed)
      if (runAbortRef.current === controller) {
        runAbortRef.current = null
        runSessionRef.current = null
        setRunSessionId(null)
        setIsDebugging(false)
      }
    }
    if (controller.signal.aborted) {
      if (signal) throw new DOMException("Stopped", "AbortError")
      return
    }
    return lastProblemRunRef.current
  }


  function cancelRun() {
    const sessionId = runSessionRef.current
    if (!sessionId) {
      setConsoleStatus("stopping")
      runAbortRef.current?.abort()
      return
    }
    setConsoleStatus("stopping")
    void stopCodeSandboxSession(sessionId).then((result) => {
      if (!result.success) throw new Error(result.error || "Stop request was rejected")
      if (runSessionRef.current === sessionId) setConsoleStatus(result.status)
    }).catch((error: unknown) => {
      if (runSessionRef.current !== sessionId) return
      setConsoleStatus("running")
      appendLiveConsoleError(`[Stop failed] ${consoleErrorMessage(error, "Network error")}\n`)
    })
  }

  function stopRun() {
    const sessionId = runSessionRef.current
    if (sessionId) void stopCodeSandboxSession(sessionId).catch(() => undefined)
    runAbortRef.current?.abort()
  }

  function resetRun() {
    stopRun()
    runSessionRef.current = null
    setRunSessionId(null)
  }

  const stopRunOnUnmount = useEffectEvent(stopRun)
  useEffect(() => () => stopRunOnUnmount(), [])

  return {
    runActiveFile, cancelRun, stopRun, resetRun, isDebugging, runSessionId, lastRunElapsed, setLastRunElapsed,
    appendLiveConsoleError,
    appendLiveConsoleInputEcho,
    appendStreamedConsoleOutput,
    consoleAutoInput,
    consoleInput,
    consoleInputClosed,
    consoleInputRef,
    consoleReturnCode,
    consoleStatus,
    consoleTruncated,
    debugOutput,
    getAutomaticInput,
    isConsoleInputRetained,
    isConsoleInputSettingsOpen,
    isSendingConsoleInput,
    resetForRun,
    setConsoleInput,
    setConsoleInputClosed,
    setConsoleInputSettingsOpen: setIsConsoleInputSettingsOpen,
    setConsoleReturnCode,
    setConsoleStatus,
    setDebugOutput,
    setIsConsoleInputSettingsOpen,
    submitConsoleInput,
    updateConsoleAutoInput,
    updateConsoleInputRetained,
  }
}
