import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react"

import { getStatus, type AILSConfig, type StatusPayload } from "../../../lib/api"
import { isStatusPayloadWorkActive, normalizeStatusPayload } from "../lib/status-payload.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

type UseAppStatusOptions = {
  hasInitialMaterial: boolean
  normalizeConfig: (config: AILSConfig) => AILSConfig
  refreshMaterials: () => Promise<unknown>
  selectedReportId: string
  setConfig: Dispatch<SetStateAction<AILSConfig>>
  setSelectedReportId: (reportId: string) => void
  settingsOpen: boolean
  getConfigSyncToken?: () => unknown
  workspaceSurface: string
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useAppStatus({
  hasInitialMaterial,
  normalizeConfig,
  refreshMaterials,
  selectedReportId,
  setConfig,
  setSelectedReportId,
  settingsOpen,
  getConfigSyncToken,
  workspaceSurface,
}: UseAppStatusOptions) {
  const [payload, setPayload] = useState<StatusPayload | null>(null)
  const [apiError, setApiError] = useState("")
  const payloadRef = useRef<StatusPayload | null>(null)
  const payloadSignatureRef = useRef("")
  const syncConfig = useEventCallback((config: AILSConfig, token: unknown) => {
    if (!settingsOpen && token !== null && (!getConfigSyncToken || getConfigSyncToken() === token)) {
      setConfig(normalizeConfig(config))
    }
  })

  const commitPayload = useCallback((nextPayload: StatusPayload) => {
    const signature = JSON.stringify(nextPayload)
    if (payloadSignatureRef.current === signature) return
    payloadSignatureRef.current = signature
    payloadRef.current = nextPayload
    setPayload(nextPayload)
  }, [])

  const refresh = useEventCallback(async function refreshStatus(options?: { scanDisk?: boolean; lite?: boolean }) {
    try {
      const configSyncToken = settingsOpen ? null : getConfigSyncToken?.()
      const requestedLite = Boolean(options?.lite && !options?.scanDisk)
      const previousPayload = payloadRef.current
      const rawPayload = await getStatus({ scanDisk: options?.scanDisk, lite: requestedLite })
      const nextPayload = normalizeStatusPayload(rawPayload, requestedLite ? previousPayload : null)
      const previousSuccessIds = new Set(
        (previousPayload?.reports ?? []).filter((report) => report.status === "success").map((report) => report.id),
      )
      const nextSuccessIds = new Set(
        (nextPayload.reports ?? []).filter((report) => report.status === "success").map((report) => report.id),
      )
      const hasNewlyCompleted = [...nextSuccessIds].some((id) => !previousSuccessIds.has(id))
      if (hasNewlyCompleted) {
        setTimeout(() => {
          void refreshMaterials()
        }, 0)
      }

      payloadRef.current = nextPayload
      commitPayload(nextPayload)
      const reportsChanged = Boolean(
        requestedLite
        && previousPayload?.reports_fingerprint
        && rawPayload.reports_fingerprint
        && previousPayload.reports_fingerprint !== rawPayload.reports_fingerprint,
      )
      const retryCandidatesChanged = Boolean(
        requestedLite
        && previousPayload?.retry_candidates_fingerprint
        && rawPayload.retry_candidates_fingerprint
        && previousPayload.retry_candidates_fingerprint !== rawPayload.retry_candidates_fingerprint,
      )
      const becameIdle = requestedLite
        && isStatusPayloadWorkActive(previousPayload)
        && !isStatusPayloadWorkActive(nextPayload)
      if (requestedLite && (reportsChanged || retryCandidatesChanged || becameIdle)) {
        setTimeout(() => {
          void refreshStatus()
        }, 0)
      }
      if (requestedLite) {
        setApiError("")
        return
      }
      syncConfig(nextPayload.config ?? {}, configSyncToken)
      setApiError("")
      const reports = nextPayload.reports ?? []
      if (workspaceSurface === "document" && !selectedReportId && reports.length > 0 && !hasInitialMaterial) {
        setSelectedReportId(reports[0].id)
      }
    } catch (error) {
      setApiError(getErrorMessage(error))
    }
  })

  return {
    apiError,
    payload,
    refresh,
    setApiError,
  }
}
