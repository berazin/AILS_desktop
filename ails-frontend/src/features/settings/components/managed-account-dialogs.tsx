import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export function prepareManagedAccountDialogs() {
  return import("./managed-account-dialogs-runtime.tsx").then(module => module.ManagedAccountDialogs)
}

export const ManagedAccountDialogs = createDeferredComponent(
  prepareManagedAccountDialogs,
  "계정",
  props => props.account.managedAuthOpen || props.account.managedCreditOpen,
)
