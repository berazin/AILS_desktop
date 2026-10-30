import { useRef,useState } from "react"
import type { PdfStudyChatSession } from "../../../lib/api"

export function useChatStudyState() {
  const [pdfQuickChatOpen,setPdfQuickChatOpen]=useState(false)
  const [pdfChatHistoryDeleteConfirm,setPdfChatHistoryDeleteConfirm]=useState(false)
  const [pdfChatSessions,setPdfChatSessions]=useState<PdfStudyChatSession[]>([])
  const [pdfChatSessionsOpen,setPdfChatSessionsOpen]=useState(false)
  const [activePdfChatSessionByDocument,setActivePdfChatSessionByDocument]=useState<Record<string,string>>({})
  const pdfChatContextRef=useRef<{ documentKey: string; path: string; pages: number[] }|null>(null)
  return {
    pdf: {
      activePdfChatSessionByDocument,
      pdfChatContextRef,
      pdfChatHistoryDeleteConfirm,
      pdfChatSessions,
      pdfChatSessionsOpen,
      pdfQuickChatOpen,
      setActivePdfChatSessionByDocument,
      setPdfChatHistoryDeleteConfirm,
      setPdfChatSessions,
      setPdfChatSessionsOpen,
      setPdfQuickChatOpen,
    }
  }
}
