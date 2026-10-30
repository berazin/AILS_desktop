import { t } from "../../../lib/i18n.ts"
import React, { useState } from "react"
import { createCodeProject, deleteCodeProject, renameCodeProject } from "../../../lib/api"
import { moveProjectPath, normalizeProjectPath, parentProjectPath } from "../lib/code-project-browser.ts"
import { consoleErrorMessage, movePersistedConsoleInputProjectSettings, removePersistedConsoleInputProjectSettings } from "../lib/code-sandbox-support.ts"

interface CodeProjectMutationsContext {
  projectFolderPath: string
  setSaveStatus: React.Dispatch<React.SetStateAction<"idle" | "success" | "error">>
  setSaveMsg: React.Dispatch<React.SetStateAction<string>>
  projectList: string[]
  baseDir: string
  setProjectsLoaded: React.Dispatch<React.SetStateAction<boolean>>
  setProjectList: React.Dispatch<React.SetStateAction<string[]>>
  handleSwitchProject: (targetProj: string, options?: { loadFiles?: boolean; flushDrafts?: boolean; }) => Promise<void>
  isManagedProblemProjectPath: (path: string) => boolean
  selectedProjectPath: string
  setSelectedProjectPath: React.Dispatch<React.SetStateAction<string>>
  projectName: string
  refreshProjects: () => Promise<void>
  setProjectName: React.Dispatch<React.SetStateAction<string>>
  setProjectFolderPath: React.Dispatch<React.SetStateAction<string>>
  setDraggingProjectPath: React.Dispatch<React.SetStateAction<string>>
}

/** Owns guarded project create/delete/rename/move and persisted path transitions. */
export function useCodeProjectMutations(context: CodeProjectMutationsContext) {
  const {
    projectFolderPath,
    setSaveStatus,
    setSaveMsg,
    projectList,
    baseDir,
    setProjectsLoaded,
    setProjectList,
    handleSwitchProject,
    isManagedProblemProjectPath,
    selectedProjectPath,
    setSelectedProjectPath,
    projectName,
    refreshProjects,
    setProjectName,
    setProjectFolderPath,
    setDraggingProjectPath,
  } = context

  const [isCreatingProject, setIsCreatingProject] = useState(false)

  const [newProjectName, setNewProjectName] = useState("")

  const [renamingProjectPath, setRenamingProjectPath] = useState("")

  const [projectRenameDraft, setProjectRenameDraft] = useState("")

  function replaceProjectPathPrefix(path: string, oldPrefix: string, newPrefix: string) {
    const normalizedPath = normalizeProjectPath(path)
    const normalizedOld = normalizeProjectPath(oldPrefix)
    const normalizedNew = normalizeProjectPath(newPrefix)
    if (!normalizedOld) return normalizedPath
    if (normalizedPath === normalizedOld) return normalizedNew
    if (normalizedPath.startsWith(`${normalizedOld}/`)) {
      const suffix = normalizedPath.slice(normalizedOld.length + 1)
      return normalizedNew ? `${normalizedNew}/${suffix}` : suffix
    }
    return normalizedPath
  }

  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const currentFolder = normalizeProjectPath(projectFolderPath)
    const rawProjectName = String(newProjectName || "").trim().replace(/\\/g, "/")
    const requestedProjectName = normalizeProjectPath(newProjectName)
    const trimmed = currentFolder ? `${currentFolder}/${requestedProjectName}` : requestedProjectName
    if (!trimmed) return
    if (rawProjectName.includes("/")) {
      setSaveStatus("error")
      setSaveMsg("Folder name cannot contain a path separator")
      return
    }
    if (projectList.some((project) => project.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setSaveStatus("error")
      setSaveMsg("Project already exists")
      return
    }

    try {
      const result = await createCodeProject({
        base_dir: baseDir,
        project_name: trimmed,
      })
      if (!result.success) throw new Error(result.error || "Project folder could not be created")

      setIsCreatingProject(false)
      setNewProjectName("")
      setProjectsLoaded(false)
      setProjectList((prev) => {
        const nextProj = normalizeProjectPath(trimmed)
        if (prev.includes(nextProj)) return prev
        return [...prev, nextProj]
      })
      await handleSwitchProject(trimmed, { loadFiles: true })
    } catch (e) {
      setSaveStatus("error")
      setSaveMsg(consoleErrorMessage(e, t("새 프로젝트 생성 실패")))
    }
  }

  async function handleDeleteProject(targetProj: string) {
    if (isManagedProblemProjectPath(targetProj)) {
      alert(t("문제 학습 폴더와 그 상위 폴더는 PDF 문제 상태와 연결되어 있어 삭제할 수 없습니다."))
      return
    }
    if (confirm(t("\"{p0}\" 프로젝트 폴더를 통째로 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.", { p0: targetProj }))) {
      try {
        const res = await deleteCodeProject({ base_dir: baseDir, project_name: targetProj })
        if (res.success) {
          removePersistedConsoleInputProjectSettings(baseDir, targetProj)
          if (selectedProjectPath === targetProj || selectedProjectPath.startsWith(`${targetProj}/`)) {
            setSelectedProjectPath("")
          }
          if (projectName === targetProj || projectName.startsWith(`${targetProj}/`)) {
            setProjectsLoaded(false)
            await handleSwitchProject(parentProjectPath(targetProj), { loadFiles: true })
          } else {
            void refreshProjects()
          }
        } else {
          alert(t("프로젝트 삭제 실패: {p0}", { p0: res.error || "알 수 없는 오류" }))
        }
      } catch (error) {
        alert(t("프로젝트 삭제 실패: {p0}", { p0: consoleErrorMessage(error, "네트워크 오류") }))
      }
    }
  }

  async function handleRenameProject(targetProj: string, nextProjName: string) {
    if (isManagedProblemProjectPath(targetProj)) {
      alert(t("문제 학습 폴더와 그 상위 폴더는 PDF 문제 상태와 연결되어 있어 이름을 변경할 수 없습니다."))
      return
    }
    const rawName = String(nextProjName || "").trim()
    if (!rawName) return
    if (rawName.includes("/") || rawName.includes("\\")) {
      setSaveStatus("error")
      setSaveMsg("Folder name cannot contain a path separator")
      return
    }
    const requestedPath = normalizeProjectPath(rawName)
    const parentPath = parentProjectPath(targetProj)
    const trimmed = parentPath ? `${parentPath}/${requestedPath}` : requestedPath
    if (!trimmed || trimmed === targetProj) return

    try {
      const res = await renameCodeProject({
        base_dir: baseDir,
        old_project_name: targetProj,
        new_project_name: trimmed,
      })
      if (res.success) {
        setRenamingProjectPath("")
        setProjectRenameDraft("")
        movePersistedConsoleInputProjectSettings(baseDir, targetProj, trimmed)
        setProjectsLoaded(false)
        void refreshProjects()
        if (projectName === targetProj || projectName.startsWith(`${targetProj}/`)) {
          setProjectName(replaceProjectPathPrefix(projectName, targetProj, trimmed))
        }
        if (selectedProjectPath === targetProj || selectedProjectPath.startsWith(`${targetProj}/`)) {
          setSelectedProjectPath(replaceProjectPathPrefix(selectedProjectPath, targetProj, trimmed))
        }
        if (projectFolderPath === targetProj || projectFolderPath.startsWith(`${targetProj}/`)) {
          setProjectFolderPath(replaceProjectPathPrefix(projectFolderPath, targetProj, trimmed))
        }
      } else {
        alert(t("프로젝트 이름 변경 실패: {p0}", { p0: res.error || "알 수 없는 오류" }))
      }
    } catch (error) {
      alert(t("프로젝트 이름 변경 실패: {p0}", { p0: consoleErrorMessage(error, "네트워크 오류") }))
    }
  }

  async function handleMoveProject(sourceProj: string, targetFolder: string) {
    if (isManagedProblemProjectPath(sourceProj)) {
      alert(t("문제 학습 폴더와 그 상위 폴더는 PDF 문제 상태와 연결되어 있어 이동할 수 없습니다."))
      setDraggingProjectPath("")
      return
    }
    let nextProjectName = ""
    try {
      nextProjectName = moveProjectPath(sourceProj, targetFolder)
    } catch (error) {
      alert(error instanceof Error ? error.message : "Move failed")
      return
    }

    const normalizedSource = normalizeProjectPath(sourceProj)
    if (!nextProjectName || nextProjectName === normalizedSource) return
    if (projectList.some((project) => project.toLocaleLowerCase() === nextProjectName.toLocaleLowerCase())) {
      alert("Target folder already has a project with the same name.")
      return
    }

    try {
      const res = await renameCodeProject({
        base_dir: baseDir,
        old_project_name: normalizedSource,
        new_project_name: nextProjectName,
      })
      if (res.success) {
        movePersistedConsoleInputProjectSettings(baseDir, normalizedSource, nextProjectName)
        setProjectsLoaded(false)
        void refreshProjects()
        if (projectName === normalizedSource || projectName.startsWith(`${normalizedSource}/`)) {
          setProjectName(replaceProjectPathPrefix(projectName, normalizedSource, nextProjectName))
        }
        if (selectedProjectPath === normalizedSource || selectedProjectPath.startsWith(`${normalizedSource}/`)) {
          setSelectedProjectPath(replaceProjectPathPrefix(selectedProjectPath, normalizedSource, nextProjectName))
        }
        if (projectFolderPath === normalizedSource || projectFolderPath.startsWith(`${normalizedSource}/`)) {
          setProjectFolderPath(replaceProjectPathPrefix(projectFolderPath, normalizedSource, nextProjectName))
        }
      } else {
        alert(`Move failed: ${res.error || "unknown error"}`)
      }
    } catch (e) {
      alert(`Move failed: ${e instanceof Error ? e.message : "network error"}`)
    } finally {
      setDraggingProjectPath("")
    }
  }

  return {
    setIsCreatingProject,
    setNewProjectName,
    isCreatingProject,
    handleMoveProject,
    setRenamingProjectPath,
    setProjectRenameDraft,
    handleDeleteProject,
    handleCreateProjectSubmit,
    newProjectName,
    renamingProjectPath,
    handleRenameProject,
    projectRenameDraft,
  }
}
