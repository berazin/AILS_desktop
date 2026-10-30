import { useState } from "react"
import type { WebSearchReport } from "../../../lib/api/chatbot.ts"

import { safeWebSource } from "../lib/safe-web-source.ts"

export function WebSearchSources({ report }: { report: WebSearchReport }) {
  const [error, setError] = useState("")
  async function open(url: string) {
    if (!safeWebSource(url)) return
    try {
      const bridge = (window as Window & { ailsDesktop?: { api?: { open_external_url?: (url: string) => Promise<unknown> } } }).ailsDesktop?.api
      if (!bridge?.open_external_url) throw new Error("외부 링크는 Electron 앱에서 열 수 있습니다.")
      await bridge.open_external_url(url)
    } catch { setError("외부 링크를 열지 못했습니다.") }
  }
  return <aside aria-label="웹 검색 출처" className="my-2 rounded-lg border border-[var(--border)] p-3 text-xs">
    <p>웹 검색 허용 · 요청 방식 {report.engine} · {report.status === "searched" ? report.requests === null ? "공급자 검색 확인 · 횟수 일부 미보고" : `공급자 보고 ${report.requests}회 검색` : report.status === "not_searched" ? "공급자 보고 검색 안 함" : "실제 검색 횟수 미보고"}</p>
    {report.engine === "auto" && <p>실제 엔진은 공급자가 자동 선택합니다. 요청 방식과 실제 실행 엔진은 다를 수 있습니다.</p>}
    <p>공급자 URL 인용입니다. 내용의 사실 검증이나 PDF 근거를 뜻하지 않습니다.</p>
    <ul>{report.sources.filter(source => safeWebSource(source.url)).map(source => <li key={source.url}>
      <button type="button" className="break-all text-left underline" onClick={() => void open(source.url)}>{source.title || source.url} — {source.url}</button>
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
  </aside>
}
