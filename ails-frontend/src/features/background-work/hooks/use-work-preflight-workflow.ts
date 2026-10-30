import { useRef, useState } from "react"

import { getWorkPreflight, type WorkPreflight, type WorkPreflightOperation } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

export function useWorkPreflightWorkflow({ setNotice }: { setNotice: (notice: string) => void }) {
  const [preflight, setPreflight] = useState<WorkPreflight | null>(null)
  const workPreflightResolveRef = useRef<((accepted: WorkPreflight | null) => void) | null>(null)

  const confirm = useEventCallback(async (
    operation: WorkPreflightOperation,
    payload: Record<string, unknown>,
  ) => {
    if (workPreflightResolveRef.current) return false
    setNotice(t("작업 방식, 예상 시간과 비용을 확인하는 중입니다."))
    try {
      const result = await getWorkPreflight({ operation, ...payload })
      setPreflight(result)
      return await new Promise<WorkPreflight | null>((resolve) => {
        workPreflightResolveRef.current = resolve
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNotice(t("작업 사전 확인 실패: {p0}", { p0: message }))
      return false
    }
  })

  const resolve = useEventCallback((accepted: boolean) => {
    const resolvePending = workPreflightResolveRef.current
    workPreflightResolveRef.current = null
    setPreflight(null)
    resolvePending?.(accepted ? preflight : null)
  })

  return { confirm, preflight, resolve }
}
