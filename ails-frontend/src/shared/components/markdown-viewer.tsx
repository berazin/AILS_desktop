import { createDeferredComponent } from "./deferred-component.tsx"

export const MarkdownViewer = createDeferredComponent(
  () => import("./markdown-viewer-runtime.tsx").then(module => module.MarkdownViewer),
  "Markdown",
  props => Boolean(props.content.trim()),
)
