import { useRef, useState, type Dispatch, type SetStateAction } from "react"

import type { PracticeDialogState, PracticeGroupChoice } from "../components/material-practice-dialog.tsx"
import { cancelMaterialPracticeGeneration, generateMaterialPractice, type LectureMaterialFolder, type LectureMaterialsPayload } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import type { InteractionRunner } from "../../code-sandbox/hooks/use-interaction-runner.ts"
import type { MaterialsController } from "./use-materials-controller.ts"
import type { WorkspaceSurface } from "../../../shared/workspace-types.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"
import { type MaterialContextTarget, type MaterialFolderContextTarget } from "../../../lib/material-navigation.ts"
import { useMaterialPracticeWindows } from "./use-material-practice-windows.ts"

type UseMaterialPracticeWorkflowOptions = {
  windows: Parameters<typeof useMaterialPracticeWindows>[0]
  applySavedPdfPage: (document: ViewerDocument) => void
  materials: MaterialsController
  prepareFolderPdfOcr: (target: MaterialFolderContextTarget) => Promise<unknown>
  runInteraction: InteractionRunner["runInteraction"]
  setDocuments: Dispatch<SetStateAction<ViewerDocument[]>>
  setNotice: (notice: string) => void
  setSelectedDocumentId: Dispatch<SetStateAction<string>>
  setSelectedReportId: Dispatch<SetStateAction<string>>
  setWorkspaceSurface: Dispatch<SetStateAction<WorkspaceSurface>>
  getHomeChatSnapshot: () => Array<{ id: string; role: "user" | "assistant"; content: string }>
}

function parentPathOf(path: string) {
  const slashIndex = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"))
  return slashIndex > 0 ? path.slice(0, slashIndex) : ""
}

function practiceGroupsFromFolder(folder: LectureMaterialFolder): PracticeGroupChoice[] {
  const groups: PracticeGroupChoice[] = folder.weeks
    .map((week) => ({
      id: `${folder.path}:week-${week.week}`,
      label: t("{p0}주차", { p0: week.week }),
      open: true,
      files: week.reports.map((report) => ({
        path: report.file_path,
        fileName: report.file_name,
        title: t("{p0}주차{p1} - {p2}", { p0: week.week, p1: report.sequence, p2: report.title }),
        selected: true,
        count: 3,
      })),
    }))
    .filter((group) => group.files.length > 0)

  const mdFiles = folder.files.filter((file) => file.kind === "md")
  if (mdFiles.length > 0) {
    groups.push({
      id: "md-files",
      label: t("기타 MD 파일"),
      open: true,
      files: mdFiles.map((file) => ({
        path: file.file_path,
        fileName: file.file_name,
        title: file.title,
        selected: true,
        count: 3,
      })),
    })
  }
  for (const child of folder.children ?? []) {
    for (const group of practiceGroupsFromFolder(child)) {
      groups.push({
        ...group,
        id: `${child.path}:${group.id}`,
        label: `${child.name} / ${group.label}`,
      })
    }
  }
  return groups
}

function practiceGroupsFromMaterialFile(target: MaterialContextTarget): PracticeGroupChoice[] {
  return [{
    id: "selected-file",
    label: t("선택한 MD 파일"),
    open: true,
    files: [{
      path: target.path,
      fileName: target.fileName,
      title: target.title,
      selected: true,
      count: 5,
    }],
  }]
}

function pdfChoicesFromMaterials(materials: LectureMaterialsPayload | null): PracticeDialogState["pdfChoices"] {
  const seen = new Set<string>()
  const result: PracticeDialogState["pdfChoices"] = []
  const visit = (folder: LectureMaterialFolder) => {
    for (const file of folder.files) {
      if (file.kind !== "pdf" || seen.has(file.file_path)) continue
      seen.add(file.file_path)
      result.push({ path: file.file_path, title: file.title || file.file_name, selected: false })
    }
    for (const child of folder.children ?? []) visit(child)
  }
  for (const folder of materials?.folders ?? []) visit(folder)
  return result
}

function newDialog(target: PracticeDialogState["target"], groups: PracticeGroupChoice[], materials: LectureMaterialsPayload | null): PracticeDialogState {
  return {
    target,
    groups,
    pdfChoices: pdfChoicesFromMaterials(materials),
    contextSources: { chat: true, bookmarks: true, memory: true },
  }
}

export function useMaterialPracticeWorkflow({
  windows,
  getHomeChatSnapshot,
  materials,
  prepareFolderPdfOcr,
  runInteraction,
  setNotice,
}: UseMaterialPracticeWorkflowOptions) {
  const [dialog, setDialog] = useState<PracticeDialogState | null>(null)
  const practiceWindows = useMaterialPracticeWindows(windows)
  const openSolver = useEventCallback((path: string) => {
    void practiceWindows.openSolver(path).catch(error => {
      setNotice(t("문제풀이를 불러오지 못했습니다") + ": " + (error instanceof Error ? error.message : String(error)))
    })
  })
  const generationIdRef = useRef("")
  const abortRef = useRef<AbortController | null>(null)

  const generateForFolder = useEventCallback((target: MaterialFolderContextTarget) => {
    materials.menus.setMaterialFolderContextMenu(null)
    const groups = practiceGroupsFromFolder(target.folder)
    if (target.reportCount <= 0 || groups.length === 0) {
      setNotice(t("이 폴더에는 연습문제를 만들 MD 파일이 없습니다."))
      return
    }
    setDialog(newDialog({ path: target.path, name: target.name }, groups, materials.data.lectureMaterials))
  })

  const generateForFile = useEventCallback((target: MaterialContextTarget) => {
    materials.menus.setMaterialContextMenu(null)
    if (target.kind !== "md") {
      setNotice(t("MD 파일만 연습문제를 만들 수 있습니다."))
      return
    }
    setDialog(newDialog(
      { path: parentPathOf(target.path), name: target.title },
      practiceGroupsFromMaterialFile(target),
      materials.data.lectureMaterials,
    ))
  })

  const generateForAll = useEventCallback(() => {
    const current = materials.data.lectureMaterials
    if (!current) {
      setNotice(t("학습 자료를 불러온 뒤 다시 시도하세요."))
      return
    }
    const groups = current.folders.flatMap((folder) => practiceGroupsFromFolder(folder))
    if (!groups.length) {
      setNotice(t("연습문제를 만들 MD 파일이 없습니다."))
      return
    }
    setDialog(newDialog({ path: current.base_path, name: t("학습 자료") }, groups, current))
  })

  const cancel = useEventCallback(() => {
    const generationId = generationIdRef.current
    generationIdRef.current = ""
    if (generationId) {
      const controller = abortRef.current
      void cancelMaterialPracticeGeneration(generationId)
        .then((result) => {
          if (result.cancelled) controller?.abort()
        })
        .catch((error) => console.warn("Practice cancellation failed", error))
      abortRef.current = null
    }
    setDialog(null)
  })

  const runFolderPdfOcr = useEventCallback(async (target: MaterialFolderContextTarget) => {
    materials.menus.setMaterialFolderContextMenu(null)
    await prepareFolderPdfOcr(target)
  })

  const submit = useEventCallback(async () => {
    if (!dialog) return
    const fileCounts = Object.fromEntries(
      dialog.groups
        .flatMap((group) => group.files)
        .filter((item) => item.selected && Number.isFinite(item.count) && item.count > 0)
        .map((item) => [item.path, Math.round(Math.min(100, Math.max(1, item.count)))]),
    )
    if (Object.keys(fileCounts).length === 0) {
      setNotice(t("연습문제를 만들 MD 파일을 하나 이상 선택하세요."))
      return
    }
    const target = dialog.target
    const generationId = crypto.randomUUID()
    const controller = new AbortController()
    generationIdRef.current = generationId
    abortRef.current = controller
    await runInteraction(`material-practice-${target.path}`, t("연습문제 생성"), async () => {
      const result = await generateMaterialPractice({
        folder_path: target.path,
        file_counts: fileCounts,
        reference_pdf_paths: dialog.pdfChoices.filter((pdf) => pdf.selected).map((pdf) => pdf.path),
        context_sources: dialog.contextSources,
        home_chat: dialog.contextSources.chat ? getHomeChatSnapshot() : [],
        generation_id: generationId,
      }, controller.signal)
      materials.data.setLectureMaterials(result.materials)
      if (generationIdRef.current === generationId) {
        setDialog((current) => current?.target.path === target.path ? {
          ...current,
          result: {
            count: result.count,
            title: result.file.title,
            excludedCount: result.excluded_count ?? 0,
            excludedReasons: result.excluded_reasons ?? [],
            contextUsage: result.context_usage ?? {},
          },
        } : current)
      }
      return t("연습문제 {p0}개를 만들었습니다: {p1}", { p0: result.count, p1: result.file.title })
    })
    if (generationIdRef.current === generationId) generationIdRef.current = ""
    if (abortRef.current === controller) abortRef.current = null
  })

  return {
    dialog,
    cancel,
    generateForFile,
    generateForFolder,
    generateForAll,
    ...practiceWindows,
    openSolver,
    runFolderPdfOcr,
    setDialog,
    submit,
  }
}
