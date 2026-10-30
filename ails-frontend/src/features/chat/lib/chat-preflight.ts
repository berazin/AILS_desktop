import { waitForChatTask } from "./chat-request-cancellation.ts"

// Context and metadata checks are independent. Both must succeed before dispatch.
export function prepareChatInputs<T>(context: Promise<string>, metadata: () => Promise<T>, signal: AbortSignal) {
  return waitForChatTask(Promise.all([context, Promise.resolve().then(() => {
    signal.throwIfAborted()
    return metadata()
  })]), signal)
}
