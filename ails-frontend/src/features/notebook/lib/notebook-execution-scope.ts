import { useState, type SetStateAction } from "react"

type BatchProgress = {
  documentId: string; completed: number; total: number; currentCellIndex: number;
  phase: "running" | "complete" | "failed" | "cancelled"
} | null

function createScope() {
  return {
    runAbortControllersRef: { current: new Map<number, AbortController>() },
    batchRunningRef: { current: false },
    batchVersionRef: { current: 0 },
    restartingRef: { current: false },
  }
}

// Async callbacks retain the document that started them, even after tab changes.
export function useNotebookExecutionScope(documentId: string) {
  const [scopes, setScopes] = useState<Record<string, ReturnType<typeof createScope>>>(() => ({ [documentId]: createScope() }))
  let scope = scopes[documentId]
  if (!scope) { scope = createScope(); setScopes({ ...scopes, [documentId]: scope }) }
  const [activeCells, setActiveCells] = useState<Record<string, number>>({})
  const [progress, setProgress] = useState<Record<string, Record<number, string>>>({})
  const [batches, setBatches] = useState<Record<string, BatchProgress>>({})
  return {
    ...scope,
    activeCellIndex: activeCells[documentId] ?? 0,
    setActiveCellIndex: (index: number) => setActiveCells(current => ({ ...current, [documentId]: index })),
    runProgress: progress[documentId] ?? {},
    setRunProgress: (update: SetStateAction<Record<number, string>>) => setProgress(current => ({
      ...current, [documentId]: typeof update === "function" ? update(current[documentId] ?? {}) : update,
    })),
    batchProgress: batches[documentId] ?? null,
    setBatchProgress: (update: SetStateAction<BatchProgress>) => setBatches(current => ({
      ...current, [documentId]: typeof update === "function" ? update(current[documentId] ?? null) : update,
    })),
  }
}
