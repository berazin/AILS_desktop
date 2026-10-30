import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react"

import { t } from "../../../lib/i18n.ts"
import {
  deleteCodeProjectFile,
  saveCodeProject,
  type LanguageProfile,
} from "../../../lib/api.ts"
import {
  consoleErrorMessage,
  codeProjectLoadScope,
  createSandboxFile,
  detectLanguageFromExtension,
  movePersistedConsoleInputFileSettings,
  normalizeFileName,
  writePersistedConsoleInputSettings,
  type SandboxFile,
} from "../lib/code-sandbox-support.ts"

type SaveStatus = "idle" | "success" | "error"
type FileRequest = { sequence: number; controller: AbortController }

export function useCodeProjectFiles({
  activeFileId,
  baseDir,
  customLanguageProfiles,
  files,
  isOpen = true,
  persistProjectDrafts,
  projectName,
  refreshProjects,
  setActiveFileId,
  setFiles,
  setSaveMsg,
  setSaveStatus,
}: {
  activeFileId: string
  baseDir: string
  customLanguageProfiles: LanguageProfile[]
  files: SandboxFile[]
  isOpen?: boolean
  persistProjectDrafts: (files: SandboxFile[]) => void
  projectName: string
  refreshProjects: () => Promise<void>
  setActiveFileId: Dispatch<SetStateAction<string>>
  setFiles: Dispatch<SetStateAction<SandboxFile[]>>
  setSaveMsg: Dispatch<SetStateAction<string>>
  setSaveStatus: Dispatch<SetStateAction<SaveStatus>>
}) {

  const [isSaving, setIsSaving] = useState(false)
  const [newFileName, setNewFileName] = useState("")
  const [isAddingFile, setIsAddingFile] = useState(false)
  const [renamingFileId, setRenamingFileId] = useState("")
  const [renameDraft, setRenameDraft] = useState("")
  const scope = codeProjectLoadScope(baseDir, projectName)
  const scopeRef = useRef(scope)
  const mountedRef = useRef(false)
  const requestSequenceRef = useRef(0)
  const requestRef = useRef<FileRequest | null>(null)
  const statusTimerRef = useRef<number | null>(null)

  const abortRequest = useCallback(() => {
    requestSequenceRef.current += 1
    requestRef.current?.controller.abort()
    requestRef.current = null
    if (statusTimerRef.current !== null) {
      window.clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    scopeRef.current = scope
    mountedRef.current = isOpen
    setIsSaving(false)
    return () => {
      mountedRef.current = false
      abortRequest()
    }
  }, [scope, isOpen, abortRequest])

  const cancelProjectRequests = useCallback(() => {
    abortRequest()
    setIsSaving(false)
    setSaveStatus("idle")
    setSaveMsg("")
  }, [abortRequest, setSaveMsg, setSaveStatus])

  function beginRequest() {
    if (isSaving || requestRef.current || !mountedRef.current || scopeRef.current !== scope) return null
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current)
    statusTimerRef.current = null
    const request = { sequence: ++requestSequenceRef.current, controller: new AbortController() }
    requestRef.current = request
    setIsSaving(true)
    setSaveStatus("idle")
    setSaveMsg("")
    return request
  }

  function ownsRequest(request: FileRequest) {
    return mountedRef.current && scopeRef.current === scope && request.sequence === requestSequenceRef.current
  }

  function finishRequest(request: FileRequest) {
    if (requestRef.current !== request) return
    requestRef.current = null
    setIsSaving(false)
  }

  function acknowledgeSavedFiles(request: FileRequest, submitted: SandboxFile[], message: string) {
    if (!ownsRequest(request)) return
    setFiles((current) => {
      if (!ownsRequest(request)) return current
      const next = current.map((file) => {
        const saved = submitted.find((item) => item.id === file.id && item.name === file.name)
        return saved ? { ...file, savedCode: saved.code } : file
      })
      // Replace the pending draft write with current edits against the actual
      // submitted baseline, including edits made while the response was pending.
      persistProjectDrafts(next)
      return next
    })
    setSaveStatus("success")
    setSaveMsg(message)
    statusTimerRef.current = window.setTimeout(() => {
      if (ownsRequest(request)) setSaveStatus("idle")
      statusTimerRef.current = null
    }, 3000)
  }

  async function addFile(event?: FormEvent) {
    event?.preventDefault()
    if (!projectName.trim()) {
      setSaveStatus("error")
      setSaveMsg("Open a project folder before adding a file")
      return
    }
    const name = normalizeFileName(newFileName)
    if (!name) return
    if (name.includes("/")) {
      alert("File names cannot contain a folder path. Open the target folder first.")
      return
    }
    if (files.some((file) => file.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      alert("A file with the same name already exists.")
      return
    }
    const file = createSandboxFile(name, customLanguageProfiles)
    const nextFiles = [...files, file].map((item) => ({ ...item }))
    const request = beginRequest()
    if (!request) return
    const previousActiveFileId = activeFileId
    setFiles(nextFiles)
    setActiveFileId(file.id)
    setNewFileName("")
    setIsAddingFile(false)
    setSaveStatus("idle")
    setSaveMsg("")
    persistProjectDrafts(nextFiles)

    function rollbackCreation(request: FileRequest) {
      setFiles((current) => {
        if (!ownsRequest(request)) return current
        const next = current.filter((item) => item.id !== file.id || item.code !== file.code)
        if (next.length !== current.length) {
          setActiveFileId((currentId) => currentId === file.id ? previousActiveFileId : currentId)
        }
        persistProjectDrafts(next)
        return next
      })
    }

    try {
      const result = await saveCodeProject({
        base_dir: baseDir,
        project_name: projectName.trim(),
        files: nextFiles.map((item) => ({ name: item.name, code: item.code })),
      }, request.controller.signal)
      if (!ownsRequest(request)) return
      if (result.success) {
        acknowledgeSavedFiles(request, nextFiles, "File created")
        void refreshProjects()
      } else {
        rollbackCreation(request)
        setSaveStatus("error")
        setSaveMsg(`Create failed: ${result.error || "unknown error"}`)
      }
    } catch (error) {
      if (!ownsRequest(request)) return
      rollbackCreation(request)
      setSaveStatus("error")
      setSaveMsg(`Create failed: ${consoleErrorMessage(error, "network error")}`)
    } finally {
      finishRequest(request)
    }
  }

  function startRename(file: SandboxFile) {
    setRenamingFileId(file.id)
    setRenameDraft(file.name)
  }

  async function commitRename(fileId: string) {
    const nextName = normalizeFileName(renameDraft)
    if (!nextName) return
    const renamedFile = files.find((file) => file.id === fileId)
    if (!renamedFile) return
    if (nextName.includes("/")) {
      alert("File names cannot contain a folder path. Open the target folder first.")
      return
    }
    if (files.some((file) => file.id !== fileId && file.name.toLocaleLowerCase() === nextName.toLocaleLowerCase())) {
      alert("A file with the same name already exists.")
      return
    }
    const nextFiles = files.map((file) => (
      file.id === fileId
        ? { ...file, name: nextName, language: detectLanguageFromExtension(nextName, customLanguageProfiles) }
        : { ...file }
    ))
    const request = beginRequest()
    if (!request) return
    movePersistedConsoleInputFileSettings(baseDir, projectName, renamedFile.name, nextName)
    setFiles(nextFiles)
    setRenamingFileId("")
    setRenameDraft("")
    setSaveStatus("idle")
    setSaveMsg("")
    persistProjectDrafts(nextFiles)

    try {
      const result = await saveCodeProject({
        base_dir: baseDir,
        project_name: projectName.trim(),
        files: nextFiles.map((item) => ({ name: item.name, code: item.code })),
      }, request.controller.signal)
      if (!ownsRequest(request)) return
      if (result.success) {
        acknowledgeSavedFiles(request, nextFiles, "File renamed")
      } else {
        setSaveStatus("error")
        setSaveMsg(`Rename failed: ${result.error || "unknown error"}`)
      }
    } catch (error) {
      if (!ownsRequest(request)) return
      setSaveStatus("error")
      setSaveMsg(`Rename failed: ${consoleErrorMessage(error, "network error")}`)
    } finally {
      finishRequest(request)
    }
  }

  async function deleteFile(fileId: string) {
    const targetFile = files.find((file) => file.id === fileId)
    if (!targetFile) return
    if (confirm(t(`"{p0}" 파일을 삭제하시겠습니까?`, { p0: targetFile.name }))) {
      const request = beginRequest()
      if (!request) return
      try {
        const result = await deleteCodeProjectFile({
          base_dir: baseDir,
          project_name: projectName.trim(),
          file_name: targetFile.name,
        }, request.controller.signal)
        if (!ownsRequest(request)) return
        if (!result.success) {
          alert(t(`파일 삭제 실패: {p0}`, { p0: result.error || "알 수 없는 오류" }))
          return
        }
        writePersistedConsoleInputSettings(baseDir, projectName, targetFile.name, { retained: false, input: "" })
        setFiles((current) => {
          if (!ownsRequest(request)) return current
          const index = current.findIndex((file) => file.id === fileId && file.name === targetFile.name)
          if (index < 0) return current
          const remaining = current.filter((_, currentIndex) => currentIndex !== index)
          setActiveFileId((currentId) => currentId === fileId
            ? remaining[Math.min(index, remaining.length - 1)]?.id || ""
            : currentId)
          persistProjectDrafts(remaining)
          return remaining
        })
      } catch (error) {
        if (ownsRequest(request)) {
          alert(t(`파일 삭제 실패: {p0}`, { p0: consoleErrorMessage(error, "네트워크 오류") }))
        }
      } finally {
        finishRequest(request)
      }
    }
  }



  async function saveProject(saveAll: boolean = true) {
    if (!projectName.trim()) return
    const submitted = files.map((file) => ({ ...file }))
    const request = beginRequest()
    if (!request) return
    try {
      const result = await saveCodeProject({
        base_dir: baseDir,
        project_name: projectName.trim(),
        files: submitted.map((file) => ({ name: file.name, code: file.code })),
      }, request.controller.signal)
      if (!ownsRequest(request)) return
      if (result.success) {
        acknowledgeSavedFiles(request, submitted, saveAll ? "Submitted files saved" : "Submitted changes saved")
      } else {
        setSaveStatus("error")
        setSaveMsg(`Save failed: ${result.error || "unknown error"}`)
      }
    } catch (error) {
      if (!ownsRequest(request)) return
      setSaveStatus("error")
      setSaveMsg(`Save failed: ${consoleErrorMessage(error, "network error")}`)
    } finally {
      finishRequest(request)
    }
  }
  return {
    saveProject, isSaving, setIsSaving, cancelProjectRequests,
    addFile,
    commitRename,
    deleteFile,
    isAddingFile,
    newFileName,
    renameDraft,
    renamingFileId,
    setIsAddingFile,
    setNewFileName,
    setRenameDraft,
    setRenamingFileId,
    startRename,
  }
}
