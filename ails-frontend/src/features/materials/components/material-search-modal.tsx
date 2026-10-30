import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export const MaterialSearchModal = createDeferredComponent(
  () => import("./material-search-modal-runtime.tsx").then(module => module.MaterialSearchModal),
  "Search",
  props => props.controller.isOpen && props.controller.presentation !== "inline",
)
