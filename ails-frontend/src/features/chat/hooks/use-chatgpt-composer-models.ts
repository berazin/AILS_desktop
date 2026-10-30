import { useCallback, useEffect, useState } from "react"
import { getChatGPTModels } from "../../../lib/api/chatgpt.ts"
import { t } from "../../../lib/i18n.ts"

export function useChatGPTComposerModels(open: boolean) {
  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let cancelled = false, timedOut = false
    setLoading(true); setError("")
    const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 15_000)
    void getChatGPTModels(controller.signal).then(result => {
      if (!Array.isArray(result.models)) throw new Error(t("ChatGPT 모델 목록 응답을 읽지 못했습니다."))
      if (!cancelled) setModels(result.models)
    }).catch(failure => {
      if (cancelled) return
      setModels([])
      setError(timedOut ? t("ChatGPT 모델 목록 조회 시간이 초과됐습니다. 다시 불러와 주세요.")
        : failure instanceof Error ? failure.message : String(failure))
    }).finally(() => {
      window.clearTimeout(timer)
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort() }
  }, [open, revision])
  return { models, loading, error, reload }
}
