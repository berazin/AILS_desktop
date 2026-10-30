import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export const PdfWorkspaceViewer = createDeferredComponent(
  () => import("./pdf-workspace-viewer-runtime.tsx").then(module => module.PdfWorkspaceViewer),
  "PDF",
)
