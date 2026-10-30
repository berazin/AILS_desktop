import { memo } from "react"
import type { NotebookExecutionOutput } from "../../../lib/api/notebook.ts"
import { MarkdownViewer } from "../../../shared/components/markdown-viewer.tsx"
import { stripNotebookAnsiEscapes } from "./notebook-utils.tsx"
import { notebookStreamText } from "../lib/notebook-stream-text.ts"
import workspaceScrollbarCss from "../../../shared/ui/processbar-scroll.css?inline"

const text = (value: unknown) => Array.isArray(value) ? value.join("") : String(value ?? "")

export const NotebookOutput = memo(function NotebookOutput({ output }: { output: NotebookExecutionOutput }) {
  const data = output.data ?? {}
  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/svg+xml"]) {
    if (data[mime]) return <img alt="notebook output" className="max-h-[520px] rounded border bg-white object-contain" src={mime === "image/svg+xml" ? `data:${mime},${encodeURIComponent(text(data[mime]))}` : `data:${mime};base64,${text(data[mime])}`} />
  }
  if (data["text/html"]) {
    const html = text(data["text/html"])
    // Opaque-origin sandbox + CSP: no scripts, API access, remote resources or forms.
    // Paint the native thumb's border on hover/drag; this frame cannot run the
    // parent's proximity controller, and its gutter/hit area must stay fixed.
    const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'"><style>:root{--foreground:#172033}${workspaceScrollbarCss}*::-webkit-scrollbar-thumb:hover,*::-webkit-scrollbar-thumb:active{border-color:color-mix(in srgb,var(--foreground) 75%,transparent);background-color:color-mix(in srgb,var(--foreground) 75%,transparent)}body{font:13px system-ui;margin:8px;color:#222}table{border-collapse:collapse}th,td{padding:6px 10px;border:1px solid #ddd}pre{white-space:pre-wrap}</style></head><body>${html}</body></html>`
    return <iframe title="노트북 HTML 출력" sandbox="" referrerPolicy="no-referrer" className="w-full rounded border bg-white" style={{ height: Math.min(520, Math.max(160, (html.match(/<tr\b/gi)?.length ?? 10) * 32 + 48)) }} srcDoc={srcDoc} />
  }
  if (data["text/markdown"] || data["text/latex"]) return <MarkdownViewer content={text(data["text/markdown"] ?? data["text/latex"])} enableLooseLatexRepair />
  const value = output.output_type === "error" ? (output.traceback?.join("\n") || `${output.ename ?? "Error"}: ${output.evalue ?? ""}`)
    : output.output_type === "stream" ? text(output.text)
      : data["application/json"] ? JSON.stringify(data["application/json"], null, 2) : text(data["text/plain"])
  return value ? <pre role={output.output_type === "error" ? "alert" : undefined} className={`max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded p-3 text-xs leading-relaxed ${output.output_type === "error" ? "border border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300" : "bg-[var(--panel)] text-[var(--foreground)]"}`}>{notebookStreamText(stripNotebookAnsiEscapes(value))}</pre> : null
})
