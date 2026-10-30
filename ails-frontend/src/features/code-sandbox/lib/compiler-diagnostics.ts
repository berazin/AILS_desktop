export type CompilerDiagnosticSeverity = "error" | "warning" | "info"

export interface CompilerDiagnostic {
  file: string
  line: number
  column: number
  severity: CompilerDiagnosticSeverity
  title: string
  explanation: string
}

// eslint-disable-next-line no-control-regex -- ANSI control sequences start with ESC.
const ansiEscapePattern = /\x1b\[[0-?]*[ -/]*[@-~]/g
const colonDiagnosticPattern = /^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+)$/i
const msvcDiagnosticPattern = /^(.+)\((\d+)(?:,(\d+))?\):\s*(fatal error|error|warning|note)(?:\s+[A-Z]+\d+)?:\s*(.+)$/i

function normalizeFileName(value: string) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "")
}

function baseName(value: string) {
  const normalized = normalizeFileName(value)
  return normalized.split("/").pop() || normalized
}

function resolvedDiagnosticFile(reportedFile: string, activeFileName: string, workspaceRoot?: string) {
  const normalizedReported = normalizeFileName(reportedFile)
  if (workspaceRoot) {
    const root = normalizeFileName(workspaceRoot).replace(/\/$/, "") + "/"
    return normalizedReported.toLowerCase().startsWith(root.toLowerCase()) ? normalizedReported.slice(root.length) : normalizedReported
  }
  return baseName(normalizedReported).toLowerCase() === baseName(activeFileName).toLowerCase()
    ? activeFileName
    : normalizedReported
}

function severityForKind(kind: string): CompilerDiagnosticSeverity {
  const normalized = kind.toLowerCase()
  if (normalized.includes("error")) return "error"
  if (normalized === "warning") return "warning"
  return "info"
}

function titleForSeverity(severity: CompilerDiagnosticSeverity) {
  if (severity === "error") return "Compiler error"
  if (severity === "warning") return "Compiler warning"
  return "Compiler note"
}

export function parseCompilerDiagnostics(output: string, activeFileName: string, workspaceRoot?: string): CompilerDiagnostic[] {
  const cleanedOutput = String(output || "").replace(ansiEscapePattern, "")
  const diagnostics: CompilerDiagnostic[] = []
  for (const rawLine of cleanedOutput.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = line.match(colonDiagnosticPattern) || line.match(msvcDiagnosticPattern)
    if (!match) continue
    const severity = severityForKind(match[4])
    diagnostics.push({
      file: resolvedDiagnosticFile(match[1], activeFileName, workspaceRoot),
      line: Math.max(1, Number(match[2]) || 1),
      column: Math.max(1, Number(match[3]) || 1),
      severity,
      title: titleForSeverity(severity),
      explanation: match[5].trim(),
    })
  }
  if (diagnostics.length === 0 && /\b(?:fatal error|error|warning|note)\b/i.test(cleanedOutput)) {
    const severity = /\b(?:fatal error|error)\b/i.test(cleanedOutput)
      ? "error"
      : /\bwarning\b/i.test(cleanedOutput)
        ? "warning"
        : "info"
    diagnostics.push({
      file: activeFileName,
      line: 1,
      column: 1,
      severity,
      title: titleForSeverity(severity),
      explanation: cleanedOutput.trim().slice(0, 1200),
    })
  }
  return diagnostics
}
