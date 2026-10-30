import { useEffect, useMemo, useRef, useState } from "react"

import {
  changeNotebookCellType,
  deleteNotebookCell,
  insertNotebookCell,
  moveNotebookCell,
  notebookCellsFromRaw,
  pasteNotebookCell,
  updateNotebookCellExecution,
  type NotebookCellEdit,
  type NotebookCellType,
  type NotebookViewerCell,
} from "../components/notebook-utils.tsx"
import { t } from "../../../lib/i18n.ts"
import {
  executeNotebookCell,
  restartNotebookKernel,
  saveMaterialFile,
  type MaterialFilePayload,
  type NotebookExecutionOutput,
} from "../../../lib/api"
import { useNotebookExecutionScope } from "../lib/notebook-execution-scope.ts"
import { NotebookEditBuffer } from "../lib/notebook-edit-buffer.ts"
import { getAppDesktopApi } from "../../../lib/desktop-api.ts"

export type NotebookDocument = {
  id: string
  kind: string
  file_path: string
  raw_content?: string
}

type RunInteraction = (
  key: string,
  label: string,
  action: () => Promise<string | void>,
) => Promise<void>

type UseNotebookControllerOptions = {
  busyActions: Record<string, string>
  cells: NotebookViewerCell[]
  document: NotebookDocument | null
  applySavedDocument: (file: MaterialFilePayload) => void
  refreshMaterials: () => Promise<unknown>
  runInteraction: RunInteraction
  setNotice: (message: string) => void
  updateDocumentRawContent: (documentId: string, update: (rawContent: string) => string) => void
}

export function useNotebookController({
  busyActions,
  cells,
  document,
  runInteraction,
  setNotice,
  updateDocumentRawContent,
}: UseNotebookControllerOptions) {
  const [editing, setEditing] = useState<NotebookCellEdit | null>(null)
  const { runAbortControllersRef, batchRunningRef, batchVersionRef, restartingRef,
    activeCellIndex, setActiveCellIndex, runProgress, setRunProgress, batchProgress, setBatchProgress } = useNotebookExecutionScope(document?.id ?? "")
  const runKeyPrefix = `notebook-cell-run-${JSON.stringify(document?.id)}:`
  const restartKey = `notebook-kernel-restart-${JSON.stringify(document?.id)}`
  const editBuffersRef = useRef(new Map<string, NotebookEditBuffer>())
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({})
  const [executionNotices, setExecutionNotices] = useState<Record<string, string>>({})

  function editBuffer() {
    if (!document || document.kind !== "ipynb") throw new Error("ipynb 파일이 없습니다.")
    let buffer = editBuffersRef.current.get(document.id)
    if (!buffer) {
      const target = document
      buffer = new NotebookEditBuffer(target.raw_content ?? "{}",
        (raw) => updateDocumentRawContent(target.id, () => raw),
        async (raw) => {
          try {
            await saveMaterialFile({ path: target.file_path, content: raw })
            setSaveErrors((current) => { const next = { ...current }; delete next[target.id]; return next })
          } catch (error) {
            setSaveErrors((current) => ({ ...current, [target.id]: t("노트북 저장 실패: {p0}", { p0: String(error) }) }))
            throw error
          }
        },
        (error) => setNotice(t("노트북 저장 실패: {p0}", { p0: String(error) })))
      editBuffersRef.current.set(target.id, buffer)
    }
    return buffer
  }

  useEffect(() => {
    if (document) editBuffersRef.current.get(document.id)?.sync(document.raw_content ?? "{}")
  }, [document])

  useEffect(() => getAppDesktopApi()?.on_before_close?.(async () => {
    setNotice(t("노트북 변경 내용을 저장한 뒤 종료합니다."))
    const results = await Promise.allSettled([...editBuffersRef.current.values()].map(buffer => buffer.flush()))
    const failed = results.find(result => result.status === "rejected")
    if (failed) {
      setNotice(t("노트북 저장 실패: {p0}", { p0: String(failed.reason) }))
      throw failed.reason
    }
  }), [setNotice])

  useEffect(() => {
    const buffers = editBuffersRef.current
    const id = document?.id
    return () => { if (id) void buffers.get(id)?.flush().catch((error) => setNotice(String(error))) }
  }, [document?.id, setNotice])

  useEffect(() => {
    setEditing((current) => current?.documentId === document?.id ? current : null)
  }, [document?.id])

  const runBusyCells = useMemo(() => {
    const busyCells = new Set<number>()
    for (const key of Object.keys(busyActions)) {
      if (!key.startsWith(runKeyPrefix)) continue
      const index = Number(key.slice(runKeyPrefix.length))
      if (Number.isInteger(index) && index >= 0) busyCells.add(index)
    }
    return busyCells
  }, [busyActions, runKeyPrefix])

  function enterCellEdit(cell: NotebookViewerCell) {
    if (!document || document.kind !== "ipynb") return
    setEditing({ documentId: document.id, cellIndex: cell.index })
    setNotice(t("노트북 셀 {p0} 편집 모드입니다.", { p0: cell.index + 1 }))
  }

  function leaveCellEdit() {
    if (document?.kind === "ipynb") editBuffer().snapshot()
    setEditing(null)
    setNotice(t("노트북 셀 편집 모드로 전환했습니다."))
  }

  async function saveCellEdit(draft: string, targetCellIndex?: number) {
    if (!document?.file_path || document.kind !== "ipynb") return
    const cellIndex = targetCellIndex ?? editing?.cellIndex ?? activeCellIndex
    if (cellIndex < 0) return
    setBatchProgress(current => current?.phase === "running" ? current : null)
    editBuffer().edit(cellIndex, draft)
    if (targetCellIndex === undefined) {
      setEditing(null)
      await runInteraction("notebook-cell-save", "notebook save", () => editBuffer().flush())
    }
  }

  async function saveDocument() {
    if (!document?.file_path || document.kind !== "ipynb") return
    await runInteraction("notebook-cell-save", "notebook save", async () => {
      await editBuffer().flush()
      return t("노트북을 저장했습니다.")
    })
  }

  async function changeCellType(cellIndex: number, newType: NotebookCellType) {
    if (!document?.file_path || document.kind !== "ipynb") return
    mutateCells((raw) => changeNotebookCellType(raw, cellIndex, newType),
      t("셀 타입을 {p0}(으)로 변경했습니다.", { p0: newType }))
  }

  async function pasteCell(targetIndex: number, cellData: { type: string; source: string }) {
    if (!document?.file_path || document.kind !== "ipynb") return
    if (mutateCells((raw) => pasteNotebookCell(raw, targetIndex, cellData), t("셀을 붙여넣었습니다."))) {
      setActiveCellIndex(Math.min(targetIndex + 1, cells.length))
    }
  }

  function readCell(index: number) {
    const cell = notebookCellsFromRaw(editBuffer().snapshot())[index]
    return { type: cell.type, source: cell.source }
  }

  async function executeCell(cell: NotebookViewerCell, fromBatch = false) {
    if (!document?.file_path || document.kind !== "ipynb" || cell.type !== "code") return false
    if (restartingRef.current || runAbortControllersRef.current.size || (batchRunningRef.current && !fromBatch)) return false
    if (!fromBatch) setBatchProgress(null)
    const activeDocument = document
    const runKey = `${runKeyPrefix}${cell.index}`
    const controller = new AbortController()
    runAbortControllersRef.current.set(cell.index, controller)
    let succeeded = false
    const buffer = editBuffer()
    let latestOutputs: NotebookExecutionOutput[] = []
    const applyOutputs = (outputs: NotebookExecutionOutput[], executionCount?: number | null) => {
      latestOutputs = outputs
      updateDocumentRawContent(activeDocument.id, (rawContent) => {
        try {
          return updateNotebookCellExecution(rawContent, cell.index, outputs, executionCount)
        } catch {
          return rawContent
        }
      })
    }
    ;(controller.signal as unknown as {
      onOutput?: (event: { outputs: NotebookExecutionOutput[]; execution_count?: number | null }) => void
    }).onOutput = (event) => applyOutputs(event.outputs, event.execution_count)
    ;(controller.signal as unknown as {
      onStatus?: (event: { phase?: string; elapsed_seconds?: number }) => void
    }).onStatus = (event) => setRunProgress((current) => ({ ...current, [cell.index]: event.phase === "preparing"
      ? t("Python 커널과 실행 환경을 준비하고 있습니다.")
      : t("실행 중 · {p0}초", { p0: event.elapsed_seconds ?? 0 }) }))
    try {
      await runInteraction(
        runKey,
        t("노트북 셀 {p0} 실행 (최초 실행은 파이썬 환경 준비로 수 분 소요)", { p0: cell.index + 1 }),
        async () => {
          try {
            await buffer.flush()
            controller.signal.throwIfAborted()
            const result = await executeNotebookCell(
              { path: activeDocument.file_path, cell_index: cell.index, return_file: false },
              controller.signal,
            )
            applyOutputs(result.outputs, result.execution_count)
            if (result.python_warning) setExecutionNotices(current => ({ ...current, [activeDocument.id]: result.python_warning ?? "" }))
            const failure = result.outputs.find((output) => output.output_type === "error")
            if (failure) return `${failure.ename ?? "Error"}: ${failure.evalue ?? ""}`
            succeeded = true
            return result.python_warning || t("노트북 셀 {p0} 실행 완료", { p0: cell.index + 1 })
          } catch (error) {
            if (!controller.signal.aborted) {
              const message = error instanceof Error ? error.message : String(error)
              applyOutputs([...latestOutputs, { output_type: "error", ename: "ExecutionError", evalue: message, traceback: [message] }])
            }
            throw error
          }
        },
      )
    } finally {
      runAbortControllersRef.current.delete(cell.index)
      setRunProgress((current) => { const next = { ...current }; delete next[cell.index]; return next })
    }
    return succeeded
  }

  function cancelCellRun(cell: NotebookViewerCell) {
    const controller = runAbortControllersRef.current.get(cell.index)
    if (!controller && !batchRunningRef.current) return
    controller?.abort()
    if (batchRunningRef.current) for (const pending of runAbortControllersRef.current.values()) pending.abort()
    batchVersionRef.current++
    setBatchProgress(current => current?.phase === "running" ? { ...current, phase: "cancelled" } : current)
    setNotice(t("노트북 셀 {p0} 실행을 취소했습니다.", { p0: cell.index + 1 }))
  }

  function mutateCells(action: (raw: string) => string, successMessage: string) {
    if (!document?.file_path || document.kind !== "ipynb") {
      setNotice(t("구조를 변경할 ipynb 파일이 없습니다."))
      return false
    }
    if (restartingRef.current || runAbortControllersRef.current.size || batchRunningRef.current) {
      setNotice(t("셀 실행이 끝난 뒤 구조를 변경해 주세요."))
      return false
    }
    try {
      editBuffer().update(action)
      setBatchProgress(null)
      setNotice(successMessage)
      return true
    } catch (error) { setNotice(String(error)); return false }
  }

  function insertCell(index: number, cellType: NotebookCellType, position: "above" | "below") {
    setEditing(null)
    if (mutateCells(
      (raw) => insertNotebookCell(raw, index, cellType, position),
      t("노트북 셀을 {p0}번째 위치에 추가했습니다.", { p0: position === "above" ? index + 1 : index + 2 }),
    )) setActiveCellIndex(position === "above" ? index : index + 1)
  }

  function deleteCell(index: number) {
    setEditing(null)
    void mutateCells((raw) => deleteNotebookCell(raw, index), t("노트북 셀 {p0}을 삭제했습니다.", { p0: index + 1 }))
  }

  function moveCell(index: number, offset: number) {
    setEditing(null)
    void mutateCells((raw) => moveNotebookCell(raw, index, offset), t("노트북 셀 {p0}을 이동했습니다.", { p0: index + 1 }))
  }

  async function runAllCells() {
    if (!document || document.kind !== "ipynb" || restartingRef.current || batchRunningRef.current || runAbortControllersRef.current.size) return
    batchRunningRef.current = true
    const version = ++batchVersionRef.current
    let completed = 0
    try {
      const buffer = editBuffer()
      const pending = notebookCellsFromRaw(buffer.snapshot(), document.file_path).filter(cell => cell.type === "code")
      setBatchProgress({ documentId: document.id, completed: 0, total: pending.length, currentCellIndex: pending[0]?.index ?? 0, phase: "running" })
      await buffer.flush()
      for (const cell of pending) {
        if (version !== batchVersionRef.current) break
        setBatchProgress(current => current && ({ ...current, currentCellIndex: cell.index }))
        setActiveCellIndex(cell.index)
        if (!await executeCell(cell, true)) {
          setBatchProgress(current => current && ({ ...current, phase: version === batchVersionRef.current ? "failed" : "cancelled" }))
          return
        }
        completed++
        setBatchProgress(current => current && ({ ...current, completed }))
      }
      setBatchProgress(current => current && ({ ...current, phase: completed === pending.length ? "complete" : "cancelled" }))
    } catch (error) {
      setNotice(String(error))
      setBatchProgress(current => current && ({ ...current, phase: "failed" }))
    } finally { batchRunningRef.current = false }
  }

  async function restartKernel(): Promise<boolean> {
    if (!document?.file_path || document.kind !== "ipynb") return false
    if (restartingRef.current) return false
    restartingRef.current = true
    batchVersionRef.current++
    for (const controller of runAbortControllersRef.current.values()) controller.abort()
    let restarted = false
    try {
      await runInteraction(restartKey, t("커널 재시작"), async () => {
      await restartNotebookKernel({ path: document.file_path })
      setExecutionNotices(current => { const next = { ...current }; delete next[document.id]; return next })
      restarted = true
      return t("커널을 재시작했습니다.")
      })
    } finally { restartingRef.current = false }
    return restarted
  }

  async function restartAndRunAll() {
    if (!document?.file_path || document.kind !== "ipynb") return
    if (await restartKernel()) await runAllCells()
  }

  return {
    activeCellIndex,
    cells,
    document,
    editing,
    isSaveBusy: Boolean(busyActions["notebook-cell-save"]),
    runBusyCells,
    isRestarting: Boolean(busyActions[restartKey]),
    runProgress,
    batchProgress: batchProgress?.documentId === document?.id ? batchProgress : null,
    saveError: document ? saveErrors[document.id] ?? "" : "",
    executionNotice: document ? executionNotices[document.id] ?? "" : "",
    actions: {
      cancelCellRun,
      changeCellType,
      deleteCell,
      enterCellEdit,
      insertCell,
      leaveCellEdit,
      moveCell,
      pasteCell,
      readCell,
      restartAndRunAll,
      restartKernel,
      runAllCells,
      executeCell,
      saveCellEdit,
      saveDocument,
      setActiveCellIndex,
    },
  }
}

export type NotebookController = ReturnType<typeof useNotebookController>
