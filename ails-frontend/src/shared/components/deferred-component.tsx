import { useEffect, useReducer, useState, type ComponentType } from "react"
import { t } from "../../lib/i18n.ts"

// Cache successful imports across surfaces; failed imports remain retryable.
export function createDeferredComponent<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
  label: string,
  isNeeded: (props: Props) => boolean = () => true,
) {
  let loaded: ComponentType<Props> | undefined
  let pending: Promise<ComponentType<Props>> | undefined
  const getRuntime = () => loaded ? Promise.resolve(loaded) : pending ??= load().then(component => {
    loaded = component
    return component
  }).catch(error => { pending = undefined; throw error })

  function DeferredComponent(props: Props) {
    const [Runtime, setRuntime] = useState<ComponentType<Props> | undefined>(() => loaded)
    const [error, setError] = useState("")
    const [attempt, retry] = useReducer(value => value + 1, 0)
    const needed = isNeeded(props)
    useEffect(() => {
      if (Runtime || !needed) return
      let cancelled = false
      void getRuntime().then(component => {
        if (!cancelled) setRuntime(() => component)
      }, failure => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      })
      return () => { cancelled = true }
    }, [Runtime, needed, attempt])
    // Once mounted, retain editor/dialog state when it is hidden again.
    if (Runtime) return <Runtime {...props} />
    if (!needed) return null
    return <div className="rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-sm" role={error ? "alert" : "status"}>
      <p>{label}: {error ? t("불러오지 못했습니다.") : t("불러오는 중입니다.")}</p>
      {error && <><p className="break-words text-xs">{error}</p><button type="button" className="mt-2 underline" onClick={() => { setError(""); retry() }}>{t("다시 시도")}</button></>}
    </div>
  }

  // Startup preparation and rendering share one promise and loaded component.
  // Importing the runtime elsewhere only warms the module cache; it still
  // leaves the first render waiting for an effect and another React commit.
  return Object.assign(DeferredComponent, { preload: getRuntime })
}
