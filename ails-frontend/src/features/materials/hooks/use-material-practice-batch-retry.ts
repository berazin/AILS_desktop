import { useLayoutEffect, useRef, useState } from "react"
import { retryMaterialPracticeBatch, type MaterialPracticeMutation, type MaterialPracticeQuestion, type MaterialPracticeSet, type PracticeRetryMode } from "../../../lib/api.ts"

export function useMaterialPracticeBatchRetry(context: {
  path: string; set: MaterialPracticeSet | null
  mutation: (question: MaterialPracticeQuestion) => MaterialPracticeMutation
  flush: () => Promise<boolean>
  onUpdated: (mode: PracticeRetryMode, set: MaterialPracticeSet, ids: string[]) => void
  onError: (error: string) => void
}) {
  const [selection, setSelection] = useState<{ path: string; ids: Set<string>; active: boolean }>({ path: context.path, ids: new Set(), active: false })
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const scopeRef = useRef(context.path)
  useLayoutEffect(() => { scopeRef.current = context.path }, [context.path])
  const selected = selection.path === context.path ? selection.ids : new Set<string>()
  const selecting = selection.path === context.path && selection.active
  const toggle = (id: string) => setSelection(current => {
    const ids = new Set(current.path === context.path ? current.ids : [])
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { path: context.path, ids, active: true }
  })
  const retry = async (mode: PracticeRetryMode) => {
    if (pending.current || !context.set) return
    const set = context.set
    const targets = set.questions.filter(item => mode === "wrong" ? (item.last_solve_correct ?? item.current_result?.correct) === false : mode === "all" || selected.has(item.id))
    if (!targets.length) return
    pending.current = true
    setBusy(true)
    context.onError("")
    try {
      if (!await context.flush()) return
      if (scopeRef.current !== context.path) return
      const result = await retryMaterialPracticeBatch({ path: context.path, set_id: set.set_id, mode, items: targets.map(item => {
        const { question_id, question_version, question_revision } = context.mutation(item)
        return { question_id, question_version, question_revision }
      }) })
      if (scopeRef.current !== context.path) return
      context.onUpdated(mode, result.set, result.target_ids)
      setSelection({ path: context.path, ids: new Set(), active: false })
    } catch (error) { if (scopeRef.current === context.path) context.onError(error instanceof Error ? error.message : String(error)) }
    finally { pending.current = false; setBusy(false) }
  }
  return { selected, selecting, toggle, busy, retry,
    toggleSelecting: () => setSelection({ path: context.path, active: !selecting, ids: new Set() }) }
}
