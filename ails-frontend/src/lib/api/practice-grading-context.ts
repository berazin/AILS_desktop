import { requestJson } from "./core.ts"

export type GradingContextSource = { kind: "pdf" | "material"; path: string; base_dir?: string }
export type PracticeGradingContext = { text: string; acknowledged: boolean; revision: string }
export const MAX_GRADING_CONTEXT_CHARS = 4000

export function loadPracticeGradingContext(source: GradingContextSource, signal?: AbortSignal) {
  const query = new URLSearchParams({ kind: source.kind, path: source.path, base_dir: source.base_dir ?? "" })
  return requestJson<{ context: PracticeGradingContext }>(`/practice/grading-context?${query}`, { signal })
}

export function savePracticeGradingContext(source: GradingContextSource, text: string, expectedRevision: string) {
  return requestJson<{ context: PracticeGradingContext }>("/practice/grading-context", {
    method: "POST", body: JSON.stringify({ ...source, text, expected_revision: expectedRevision }),
  })
}
