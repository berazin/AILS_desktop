import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export const SummaryGenerationDialog = createDeferredComponent(
  () => import("./summary-generation-dialog-runtime.tsx").then(module => module.SummaryGenerationDialog),
  "학습 자료 추가",
  props => props.workflow.state.open,
)
