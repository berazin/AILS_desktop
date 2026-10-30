import { useState } from "react"
import type { RetrievalState } from "../../../lib/api"

export function useChatAssistState() {
  const [aiAssistEnabled,setAiAssistEnabled]=useState(false)
  const [aiAssistBusy,setAiAssistBusy]=useState(false)
  const [retrievalStateByDocument,setRetrievalStateByDocument]=useState<Record<string,RetrievalState>>({})
  return {
    assist: {
      aiAssistBusy,
      aiAssistEnabled,
      retrievalStateByDocument,
      setAiAssistBusy,
      setAiAssistEnabled,
      setRetrievalStateByDocument,
    }
  }
}
