import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react"

import { notebookCellsFromRaw } from "../components/notebook-utils.tsx"
import type { AILSReport } from "../../../lib/api"
import type { ViewerDocument } from "../../../lib/viewer-document.ts"
import { useNotebookController } from "./use-notebook-controller.ts"

type ControllerOptions = Parameters<typeof useNotebookController>[0]

type UseNotebookWorkspaceOptions = {
  applySavedDocument: ControllerOptions["applySavedDocument"]
  busyActions: ControllerOptions["busyActions"]
  document: ViewerDocument | null
  refreshMaterials: ControllerOptions["refreshMaterials"]
  runInteraction: ControllerOptions["runInteraction"]
  setDocuments: Dispatch<SetStateAction<ViewerDocument[]>>
  setNotice: ControllerOptions["setNotice"]
  setSelectedReport: Dispatch<SetStateAction<AILSReport | null>>
}

export function useNotebookWorkspace({
  applySavedDocument,
  busyActions,
  document,
  refreshMaterials,
  runInteraction,
  setDocuments,
  setNotice,
  setSelectedReport,
}: UseNotebookWorkspaceOptions) {
  const documentKind = document?.kind ?? ""
  const documentRawContent = document?.raw_content ?? ""
  const documentFilePath = document?.file_path ?? ""
  const cells = useMemo(
    () => documentKind === "ipynb" ? notebookCellsFromRaw(documentRawContent, documentFilePath) : [],
    [documentFilePath, documentKind, documentRawContent],
  )
  const updateDocumentRawContent = useCallback(
    (documentId: string, update: (rawContent: string) => string) => {
      setDocuments((current) =>
        current.map((item) =>
          item.id === documentId
            ? { ...item, raw_content: update(item.raw_content ?? "{}") }
            : item,
        ),
      )
      setSelectedReport((current) =>
        current?.id === documentId
          ? { ...current, raw_content: update(current.raw_content ?? "{}") }
          : current,
      )
    },
    [setDocuments, setSelectedReport],
  )

  return useNotebookController({
    applySavedDocument,
    busyActions,
    cells,
    document,
    refreshMaterials,
    runInteraction,
    setNotice,
    updateDocumentRawContent,
  })
}

export type NotebookWorkspaceController = ReturnType<typeof useNotebookWorkspace>
