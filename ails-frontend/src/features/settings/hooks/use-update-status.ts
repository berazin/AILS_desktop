import { useEffect, useState } from "react"
import { updateIsBusy, type UpdateBridge, type UpdateStatus } from "../lib/update-status.ts"

const FALLBACK_STATUS: UpdateStatus = {
  supported: false,
  currentVersion: "-",
  state: "unavailable",
  updateVersion: "",
  progressPercent: 0,
  error: "",
}

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>(FALLBACK_STATUS)
  const bridge = (window as Window & { ailsDesktop?: { api?: UpdateBridge } }).ailsDesktop?.api

  useEffect(() => {
    let disposed = false
    let receivedEvent = false
    const unsubscribe = bridge?.on_update_status?.((next) => {
      if (disposed || !next) return
      receivedEvent = true
      setStatus((current) => ({ ...current, ...next }))
    })
    void bridge?.get_update_status?.().then((next) => {
      if (!disposed && !receivedEvent && next) setStatus((current) => ({ ...current, ...next }))
    }).catch((error: unknown) => {
      if (!disposed && !receivedEvent) setStatus((current) => ({
        ...current, state: "error", error: error instanceof Error ? error.message : String(error),
      }))
    })
    return () => {
      disposed = true
      if (typeof unsubscribe === "function") unsubscribe()
    }
  }, [bridge])

  return { status, setStatus, bridge, workCount: status.supported && updateIsBusy(status) ? 1 : 0 }
}
