import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export const HelpDialog = createDeferredComponent(
  () => import("./help-dialog-runtime.tsx").then(module => module.HelpDialog),
  "Help",
  props => props.open,
)
