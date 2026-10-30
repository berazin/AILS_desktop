type QuestionBlock = { kind: "text" | "code" | "output"; text: string }

export function practiceQuestionCopyText(number: string | number, blocks: QuestionBlock[], choices: string[] = []) {
  const escapedNumber = String(number).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const numberPrefix = new RegExp(`^(?:문제\\s+)?${escapedNumber}(?:[.)]\\s+|번\\s*[:.)]?\\s+)`)
  const body = blocks.map((block, index) => {
    if (block.kind === "text") return index === 0 ? block.text.trimStart().replace(numberPrefix, "") : block.text
    const runs = block.text.match(/`+/g) ?? []
    const fence = "`".repeat(Math.max(3, ...runs.map(run => run.length + 1)))
    return `${fence}${block.kind === "output" ? "text" : ""}\n${block.text}\n${fence}`
  }).join("\n\n").trim()
  const question = `${number}.${blocks[0]?.kind === "text" ? " " : "\n\n"}${body}`.trim()
  return [question, choices.map((choice, index) => `${index + 1}. ${choice}`).join("\n")].filter(Boolean).join("\n\n")
}
