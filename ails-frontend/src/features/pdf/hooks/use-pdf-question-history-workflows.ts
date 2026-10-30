import { useCallback, useState } from "react"

import {
  deletePdfStudyChatTurn,
  getPdfStudyChatConcepts,
  type PdfStudyChatConcept,
} from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"

type UsePdfQuestionHistoryWorkflowsOptions = {
  getPdfPath: () => string
  onOpen: () => void
  onNotice: (message: string) => void
  runInteraction: (
    key: string,
    label: string,
    action: () => Promise<string | void>,
    onError?: (error: unknown) => void,
  ) => Promise<void>
}

export function usePdfQuestionHistoryWorkflows({
  getPdfPath,
  onOpen,
  onNotice,
  runInteraction,
}: UsePdfQuestionHistoryWorkflowsOptions) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [concepts, setConcepts] = useState<PdfStudyChatConcept[]>([])
  const [deletePendingId, setDeletePendingId] = useState("")

  const reset = useCallback(() => {
    setOpen(false)
    setConcepts([])
    setDeletePendingId("")
    setError("")
  }, [])

  async function deleteTurn(turnId: string) {
    if (!turnId) return
    await runInteraction("pdf-question-history-delete", t("질문 기록 삭제"), async () => {
      await deletePdfStudyChatTurn(turnId)
      setConcepts((current) => current.filter((item) => item.turn_id !== turnId))
      setDeletePendingId("")
      return t("질문 기록 1개를 삭제했습니다.")
    })
  }

  async function openHistory() {
    const pdfPath = getPdfPath()
    if (!pdfPath) {
      onNotice(t("문서를 연 뒤 질문 기록을 확인하세요."))
      return
    }
    onOpen()
    setOpen(true)
    setLoading(true)
    setError("")
    try {
      setConcepts((await getPdfStudyChatConcepts(pdfPath)).concepts)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoading(false)
    }
  }

  return {
    close: () => setOpen(false),
    concepts,
    deletePendingId,
    deleteTurn,
    error,
    loading,
    open,
    openHistory,
    reset,
    setDeletePendingId,
  }
}

export type PdfQuestionHistoryWorkflows = ReturnType<typeof usePdfQuestionHistoryWorkflows>
