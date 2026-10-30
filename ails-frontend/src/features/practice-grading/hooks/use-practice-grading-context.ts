import { useEffect, useRef, useState } from "react"
import { loadPracticeGradingContext, savePracticeGradingContext, type GradingContextSource, type PracticeGradingContext } from "../../../lib/api/practice-grading-context.ts"

export function usePracticeGradingContext(source: GradingContextSource, active: boolean) {
  const [record, setRecord] = useState<PracticeGradingContext | null>(null)
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const loaded = useRef("")
  const { kind, path, base_dir } = source
  useEffect(() => {
    if (!active || !path) return
    const loadKey = JSON.stringify([kind, path, base_dir, reload])
    if (loaded.current === loadKey) return
    const controller = new AbortController()
    let disposed = false
    setLoading(true)
    setError("")
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    void loadPracticeGradingContext({ kind, path, base_dir }, controller.signal).then(result => {
      if (disposed) return
      if (!result.context || typeof result.context.text !== "string" || typeof result.context.acknowledged !== "boolean" || typeof result.context.revision !== "string") throw new Error("저장된 채점 문맥을 확인하지 못했습니다.")
      loaded.current = loadKey
      setRecord(result.context)
      setDraft(result.context.text)
      setOpen(!result.context.acknowledged)
    }).catch(reason => { if (!disposed) setError(controller.signal.aborted ? "채점 문맥 조회 시간이 초과됐습니다. 다시 불러와 주세요." : reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { window.clearTimeout(timeout); if (!disposed) setLoading(false) })
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort() }
  }, [active, kind, path, base_dir, reload])

  async function save(text: string) {
    if (!record || saving) return
    setSaving(true)
    setError("")
    try {
      const result = await savePracticeGradingContext(source, text, record.revision)
      setRecord(result.context)
      setDraft(result.context.text)
      setOpen(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  return { record, draft, setDraft, open, loading, saving, error, save,
    edit: () => { setDraft(record?.text ?? ""); setError(""); setOpen(true) },
    cancel: () => setOpen(false), reload: () => setReload(value => value + 1) }
}
