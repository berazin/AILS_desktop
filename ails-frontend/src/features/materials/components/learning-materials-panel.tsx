import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export const LearningMaterialsPanel = createDeferredComponent(
  () => import("./learning-materials-panel-runtime.tsx").then(module => module.LearningMaterialsPanel),
  "Materials",
  props => props.open,
)
