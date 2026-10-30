// Interpret progress-line carriage returns/backspaces without changing stored MIME output.
export function notebookStreamText(text: string) {
  const lines: string[] = []
  let line: string[] = [], cursor = 0
  for (const char of text) {
    if (char === "\n") { lines.push(line.join("")); line = []; cursor = 0 }
    else if (char === "\r") cursor = 0
    else if (char === "\b") cursor = Math.max(0, cursor - 1)
    else { line[cursor] = char; cursor++ }
  }
  return [...lines, line.join("")].join("\n")
}
