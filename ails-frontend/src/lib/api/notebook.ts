import { requestJson, requestNdjsonStream } from "./core.ts"
import type { MaterialFilePayload } from "./materials.ts"

export interface NotebookExecutionOutput {
  output_type: string
  name?: string
  text?: string | string[]
  data?: Record<string, unknown>
  metadata?: Record<string, unknown>
  execution_count?: number | null
  ename?: string
  evalue?: string
  traceback?: string[]
}

export function executeNotebookCell(payload: { path: string; cell_index: number; timeout?: number; return_file?: boolean }, signal?: AbortSignal) {
  return (async () => {
    const handleOutput = (signal as unknown as { onOutput?: (event: { outputs: NotebookExecutionOutput[]; execution_count?: number | null }) => void })?.onOutput
    const handleStatus = (signal as unknown as { onStatus?: (event: { phase?: string; elapsed_seconds?: number }) => void })?.onStatus
    let completed = false

    let finalResult: {
      file?: MaterialFilePayload
      raw_content?: string
      outputs: NotebookExecutionOutput[]
      execution_count?: number | null
      text?: string
      python_warning?: string
    } = {
      outputs: [],
    }

    await requestNdjsonStream<{
      type?: string
      outputs?: NotebookExecutionOutput[]
      execution_count?: number | null
      text?: string
      python_warning?: string
      file?: MaterialFilePayload
      error?: string
      phase?: string
      elapsed_seconds?: number
    }>("/material-file/notebook/execute", {
      method: "POST",
      body: JSON.stringify(payload),
      onEvent: (event) => {
        if (event.type === "status") {
          handleStatus?.(event)
        } else if (event.type === "output") {
          if (Array.isArray(event.outputs)) {
            finalResult.outputs = event.outputs
            finalResult.execution_count = event.execution_count
            handleOutput?.({ outputs: event.outputs, execution_count: event.execution_count })
          }
        } else if (event.type === "execute_input") {
          finalResult.execution_count = event.execution_count
          handleOutput?.({ outputs: finalResult.outputs, execution_count: event.execution_count })
        } else if (event.type === "done") {
          completed = true
          finalResult = {
            file: event.file,
            outputs: event.outputs ?? finalResult.outputs,
            execution_count: event.execution_count ?? finalResult.execution_count,
            text: event.text,
            python_warning: event.python_warning,
          }
          handleOutput?.({ outputs: finalResult.outputs, execution_count: finalResult.execution_count })
        }
      },
      signal,
    })

    if (!completed) throw new Error("노트북 실행 응답이 중간에 끊겼습니다. 백엔드와 Python 커널 상태를 확인해 주세요.")
    return finalResult
  })()
}

export function restartNotebookKernel(payload: { path: string }) {
  return requestJson<{ restarted: boolean }>("/material-file/notebook/restart", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}
