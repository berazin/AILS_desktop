import { useEffect, useState, type ComponentProps } from "react"
import { t } from "../../../lib/i18n.ts"
import { prepareManagedAccountDialogs } from "./managed-account-dialogs.tsx"

type Runtime = typeof import("./settings-surface.tsx")
type Props = ComponentProps<Runtime["SettingsSurface"]>
let pending: Promise<Runtime> | undefined
function loadRuntime() {
  // Prepare the account surface before settings mounts and starts its API reads.
  // Otherwise those requests can occupy Chromium's same-origin connections and
  // leave the login dialog's first module download queued behind them.
  return pending ??= Promise.all([
    import("./settings-surface.tsx"),
    prepareManagedAccountDialogs(),
  ]).then(([settings]) => settings).catch(error => { pending = undefined; throw error })
}

export function SettingsSurface(props: Props) {
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    let disposed = false
    void loadRuntime().then(module => { if (!disposed) setRuntime(module) }, failure => {
      if (!disposed) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { disposed = true }
  }, [])
  if (runtime) return <runtime.SettingsSurface {...props} />
  return <div className="fixed inset-x-0 bottom-0 top-8 z-[90] bg-[var(--background)] p-8" role={error ? "alert" : "status"}>
    <p>{error ? t("설정을 불러오지 못했습니다.") : t("설정을 불러오는 중입니다.")}</p>
    {error && <><p>{error}</p><p>{t("앱으로 돌아가 작업을 저장한 뒤 앱을 다시 실행해 주세요.")}</p></>}
    <button onClick={() => props.workflows.close()}>{t("앱으로 돌아가기")}</button>
  </div>
}
