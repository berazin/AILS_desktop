import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react"
import { searchPdfText, type PdfSearchResult } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

const INPUT_SETTLE_MS = 120

export function usePdfLiveSearch({ activePath, query, open, available, setResults, setLoading, setNotice }: {
  activePath: string
  query: string
  open: boolean
  available: boolean
  setResults: Dispatch<SetStateAction<PdfSearchResult[]>>
  setLoading: (loading: boolean) => void
  setNotice: (message: string) => void
}) {
  const request = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = useCallback(() => {
    sequence.current++
    request.current?.abort()
    request.current = null
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])
  const isCurrent = useEventCallback((id: number, path: string, value: string) =>
    id === sequence.current && open && activePath === path && query === value,
  )
  const search = useEventCallback(async () => {
    cancel()
    setResults(current => current.length ? [] : current)
    if (!open || !activePath || !query.trim()) { setLoading(false); return }
    const id = sequence.current
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    try {
      const result = await searchPdfText(activePath, query, controller.signal)
      if (!controller.signal.aborted && isCurrent(id, activePath, query)) setResults(result.results)
    } catch (error) {
      if (!controller.signal.aborted && isCurrent(id, activePath, query)) {
        setNotice(t("PDF 검색 실패: {p0}", { p0: error instanceof Error ? error.message : String(error) }))
      }
    } finally {
      if (isCurrent(id, activePath, query)) setLoading(false)
      if (request.current === controller) request.current = null
    }
  })

  useEffect(() => {
    cancel()
    if (!open || !available || !activePath || !query.trim()) {
      setLoading(false)
      setResults(current => current.length ? [] : current)
      return cancel
    }
    setLoading(true)
    timer.current = setTimeout(() => { timer.current = null; void search() }, INPUT_SETTLE_MS)
    return cancel
  }, [activePath, query, open, available, cancel, search, setResults, setLoading])

  return search
}
