import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export type { PdfBookmarkDialogTab } from "./pdf-bookmark-dialog-runtime.tsx"

export const PdfBookmarkDialog = createDeferredComponent(
  () => import("./pdf-bookmark-dialog-runtime.tsx").then(module => module.PdfBookmarkDialog),
  "Bookmarks",
  props => props.open,
)
