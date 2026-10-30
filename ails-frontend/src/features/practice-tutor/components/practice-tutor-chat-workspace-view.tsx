import { createDeferredComponent } from "../../../shared/components/deferred-component.tsx"

export const PracticeTutorChatWorkspaceView = createDeferredComponent(
  () => import("./practice-tutor-chat-workspace-view-runtime.tsx").then(module => module.PracticeTutorChatWorkspaceView),
  "AI Tutor",
)
