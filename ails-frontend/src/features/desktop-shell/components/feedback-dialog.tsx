import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export type { FeedbackCategory } from "./feedback-dialog-runtime.tsx"

export const FeedbackDialog = createDeferredComponent(
  () => import("./feedback-dialog-runtime.tsx").then(module => module.FeedbackDialog),
  "Feedback",
  props => props.open,
)
