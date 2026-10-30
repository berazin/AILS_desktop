import { useEffect, useState } from "react"

import { getReport, type AILSReport } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"

export function useSelectedReport({ setNotice }: { setNotice: (notice: string) => void }) {
  const [selectedReportId, setSelectedReportId] = useState("")
  const [selectedReport, setSelectedReport] = useState<AILSReport | null>(null)

  useEffect(() => {
    if (!selectedReportId) {
      setSelectedReport(null)
      return
    }
    let cancelled = false
    void getReport(selectedReportId)
      .then(({ report }) => {
        if (!cancelled) setSelectedReport(report)
      })
      .catch((error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setNotice(t("정리본 로드 실패: {p0}", { p0: message }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedReportId, setNotice])

  return {
    selectedReport,
    selectedReportId,
    setSelectedReport,
    setSelectedReportId,
  }
}
