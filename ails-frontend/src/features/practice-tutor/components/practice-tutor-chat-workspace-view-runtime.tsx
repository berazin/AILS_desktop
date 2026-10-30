import type { ComponentProps } from "react"
import { ChatWorkspaceView } from "../../chat/components/chat-workspace-view.tsx"
import { usePracticeTutorChat } from "../hooks/use-practice-tutor-chat.tsx"

type Props = Omit<ComponentProps<typeof ChatWorkspaceView>, "mode" | "integration">

export function PracticeTutorChatWorkspaceView(props: Props) {
  const tutor = usePracticeTutorChat(true, props.controller, props.models, props.busy, props.workspace.setNotice)
  return <ChatWorkspaceView {...props} mode="tutor" integration={tutor ? {
    onAsk: tutor.ask,
    embeddedHeader: tutor.header,
    composerContext: tutor.contextControl,
    composerControls: tutor.composerControls,
  } : undefined} />
}
