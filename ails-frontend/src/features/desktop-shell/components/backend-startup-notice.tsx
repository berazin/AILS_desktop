import { useEffect, useState } from "react"
import { requestJson } from "../../../lib/api/core.ts"
import { t } from "../../../lib/i18n.ts"

type StartupState = "starting" | "ready" | "failed"

/** The real shell is usable while read requests wait for the local service. */
export function BackendStartupNotice() {
  const enabled = Boolean((window as unknown as { ailsDesktop?: { api?: { startupGateway?: boolean } } }).ailsDesktop?.api?.startupGateway)
  const [state, setState] = useState<StartupState>(enabled ? "starting" : "ready")
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await requestJson<{ state: StartupState }>("/desktop-startup", { signal: controller.signal })
        if (controller.signal.aborted) return
        setState(result.state)
        if (result.state === "ready") return
      } catch {
        if (controller.signal.aborted) return
        setState("failed")
      }
      timer = setTimeout(() => { void poll() }, 250)
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [enabled])
  if (state === "ready") return null
  return <div data-ails-backend-startup={state} role="status" aria-live="polite"
    className="fixed bottom-4 left-1/2 z-[290] -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] shadow-lg">
    {state === "starting"
      ? t("자료와 편집 기능을 준비 중입니다. 창과 탭은 먼저 사용할 수 있습니다.")
      : t("자료를 준비하지 못했습니다. 오류 창에서 다시 시도해 주세요.")}
  </div>
}
