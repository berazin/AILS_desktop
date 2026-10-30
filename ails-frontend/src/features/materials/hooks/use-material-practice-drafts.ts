import { useEffect, useRef, useState } from "react"
import { saveMaterialPracticeAnswer, type MaterialPracticeMutation, type MaterialPracticeQuestion } from "../../../lib/api.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

/** Serializes drafts across navigation/close and leaves failed saves retryable. */
export function useMaterialPracticeDrafts(onSaved: (question: MaterialPracticeQuestion, path: string) => void, onError: (message: string) => void) {
  const drafts = useRef(new Map<string, MaterialPracticeMutation & { answer_text: string }>())
  const queue = useRef<Promise<boolean>>(Promise.resolve(true))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saving, setSaving] = useState(false)
  const saved = useEventCallback(onSaved)
  const failed = useEventCallback(onError)
  const flush = useEventCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const operation = queue.current.then(async () => {
      if (!drafts.current.size) return true
      setSaving(true)
      try {
        while (drafts.current.size) {
          const pending = [...drafts.current.entries()]
          for (const [key, payload] of pending) {
            if (drafts.current.get(key) !== payload) continue
            const result = await saveMaterialPracticeAnswer(payload)
            if (drafts.current.get(key) === payload) {
              drafts.current.delete(key)
              saved(result.question, payload.path)
            }
          }
        }
        return true
      } catch (error) {
        failed(error instanceof Error ? error.message : String(error))
        return false
      } finally { setSaving(false) }
    })
    queue.current = operation
    return operation
  })
  const stage = (payload: MaterialPracticeMutation & { answer_text: string }) => {
    drafts.current.set(`${payload.path}:${payload.question_id}:${payload.question_revision}`, payload)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 600)
  }
  useEffect(() => () => { void flush() }, [flush])
  return { stage, flush, saving }
}
