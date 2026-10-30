import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export const BackgroundWorkQueueDialog = createDeferredComponent(
  () => import("./background-work-queue-dialog-runtime.tsx").then(module => module.BackgroundWorkQueueDialog),
  "Background work",
  props => props.open,
)
