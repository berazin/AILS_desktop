import type { ChatbotUsage, WebSearchReport } from "../../../lib/api/chatbot.ts"

export function mergeWebSearchReports(usages: ChatbotUsage[]): WebSearchReport | undefined {
  const reports = usages.flatMap(usage => usage.web_search ? [usage.web_search] : [])
  if (!reports.length) return undefined
  const known = reports.every(report => typeof report.requests === "number")
  const sources = new Map(reports.flatMap(report => report.sources).map(source => [source.url, source]))
  return {
    engine: [...new Set(reports.map(report => report.engine))].join(" / "),
    requests: known ? reports.reduce((total, report) => total + (report.requests ?? 0), 0) : null,
    status: reports.some(report => report.status === "searched") ? "searched" : known ? "not_searched" : "unreported",
    sources: [...sources.values()].slice(0, 25),
  }
}
