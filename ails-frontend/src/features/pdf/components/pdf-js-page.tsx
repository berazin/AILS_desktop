import { useEffect, useState, type ComponentProps } from "react"

type Runtime = typeof import("./pdf-js-page-runtime.tsx")
type Props = ComponentProps<Runtime["PdfJsPage"]>
let pending: Promise<Runtime> | undefined
function loadRuntime() {
  return pending ??= import("./pdf-js-page-runtime.tsx").catch(error => { pending = undefined; throw error })
}

export function PdfJsPage(props: Props) {
  const [runtime, setRuntime] = useState<Runtime | null>(null)
  const [error, setError] = useState("")
  const enabled = Boolean(props.pdfPath)
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    setError("")
    void loadRuntime().then(module => { if (!disposed) setRuntime(module) }, failure => {
      if (!disposed) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { disposed = true }
  }, [enabled])
  if (!enabled) return null
  if (error) return <div role="alert">PDF 뷰어를 불러오지 못했습니다. {error}<p>다른 작업을 저장한 뒤 앱을 다시 실행해 주세요.</p></div>
  if (!runtime) return <div role="status" className={props.className} style={props.style}>PDF 뷰어를 준비하고 있습니다.</div>
  return <runtime.PdfJsPage {...props} />
}
