import { useEffect, useRef, useState } from "react"
import { getAppDesktopApi, type ExternalViewerFeature } from "../../../lib/desktop-api.ts"
import { useEventCallback } from "../../../shared/hooks/use-event-callback.ts"

type Request = { path: string; feature: ExternalViewerFeature; id?: string }
type Options = {
  path?: string
  loading?: boolean
  blocked: boolean
  activate: (request: Request) => void
}

export function useViewerFeatureActivation({ path, loading, blocked, activate }: Options) {
  const [pending, request] = useState<Request | null>(null)
  const apply = useEventCallback(activate)
  const acknowledgements = useRef(new Set<number>())
  const afterFrame = useEventCallback((callback: () => void) => {
    const id = requestAnimationFrame(() => {
      acknowledgements.current.delete(id)
      callback()
    })
    acknowledgements.current.add(id)
  })
  useEffect(() => {
    const frames = acknowledgements.current
    return () => { for (const id of frames) cancelAnimationFrame(id); frames.clear() }
  }, [])
  useEffect(() => getAppDesktopApi()?.on_viewer_activate?.(request), [])
  useEffect(() => {
    if (!pending || loading || blocked) return
    const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase()
    if (!path || normalize(path) !== normalize(pending.path)) return
    const frame = requestAnimationFrame(() => {
      request(null)
      apply(pending)
      if (pending.id) afterFrame(() => {
        afterFrame(() => {
          void getAppDesktopApi()?.viewer_workspace_presented?.({ id: pending.id!, phase: "activation" })
        })
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [pending, path, loading, blocked, apply, afterFrame])
  return request
}
