import { useEffect, useState, type ComponentType, type CSSProperties } from "react"

export type CodeHighlightProps = {
  children: string
  language: string
  customStyle: CSSProperties
}

let runtime: Promise<ComponentType<CodeHighlightProps>> | undefined
function loadHighlight() {
  return runtime ??= import("./code-highlight-runtime.tsx")
    .then(module => module.CodeHighlight)
    .catch((error: unknown) => { runtime = undefined; throw error })
}

/** Code remains readable/selectable even while the optional grammar bundle loads. */
export function DeferredCodeHighlight(props: CodeHighlightProps) {
  const [Highlight, setHighlight] = useState<ComponentType<CodeHighlightProps> | null>(null)
  useEffect(() => {
    let active = true
    void loadHighlight().then(component => {
      if (active) setHighlight(() => component)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])
  if (Highlight) return <Highlight {...props} />
  const { children, customStyle, language, ...anchors } = props
  return <div {...anchors} style={{ ...customStyle, overflowX: "auto", whiteSpace: "pre" }}>
    <code className={`language-${language}`}>{children}</code>
  </div>
}
