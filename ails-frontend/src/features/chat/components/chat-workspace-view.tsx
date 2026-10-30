import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export const ChatWorkspaceView = createDeferredComponent(
  () => import("./chat-workspace-view-runtime.tsx").then(module => module.ChatWorkspaceView),
  "Chat",
)
