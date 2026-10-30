import { requestJson } from "./core.ts"

export const RESEARCH_TOOL_NAMES = new Set([
  "grep_search", "semantic_search", "read_context", "get_document_outline", "inspect_pdf_page", "calculator",
])

export function executeResearchTool(name: string, args: Record<string, unknown>) {
  return requestJson<Record<string, unknown>>("/chatbot/research-tool", {
    method: "POST", body: JSON.stringify({ name, arguments: args }),
  })
}
