import { loader } from "@monaco-editor/react"
import * as Monaco from "monaco-editor"
import { createMonacoWorker } from './monaco-workers.ts'

;(globalThis as typeof globalThis & { MonacoEnvironment?: Monaco.Environment }).MonacoEnvironment = {
  getWorker: createMonacoWorker,
}
loader.config({ monaco: Monaco })
