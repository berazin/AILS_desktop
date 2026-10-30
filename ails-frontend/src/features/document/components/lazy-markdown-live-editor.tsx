import { lazy, Suspense, useEffect, useState, type ComponentProps } from "react"

const Runtime = lazy(() => import("./markdown-live-editor.tsx").then(module => ({ default: module.MarkdownLiveEditor })))

export function MarkdownLiveEditor(props: ComponentProps<typeof Runtime>) {
  const [opened, setOpened] = useState(props.active)
  useEffect(() => { if (props.active) setOpened(true) }, [props.active])
  // Keep the same editor after its first edit, retaining undo and cursor state.
  if (!props.active && !opened) return null
  return <Suspense fallback={<p role="status">편집기를 준비하고 있습니다.</p>}><Runtime {...props} /></Suspense>
}
