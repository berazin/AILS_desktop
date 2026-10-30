import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import { copyTextToClipboard } from "../../../shared/clipboard/copy-text.ts"
import { practiceQuestionCopyText } from "../lib/practice-question-copy.ts"

type Props = {
  number: string | number
  blocks: Parameters<typeof practiceQuestionCopyText>[1]
  choices?: string[]
}

export function PracticeQuestionCopyButton({ number, blocks, choices }: Props) {
  const text = practiceQuestionCopyText(number, blocks, choices)
  const [result, setResult] = useState<{ text: string; status: "copied" | "error" } | null>(null)
  const status = result?.text === text ? result.status : null
  useEffect(() => {
    if (!result) return
    const timer = window.setTimeout(() => setResult(null), 2000)
    return () => window.clearTimeout(timer)
  }, [result])
  const copy = async () => {
    try {
      await copyTextToClipboard(text)
      setResult({ text, status: "copied" })
    } catch {
      setResult({ text, status: "error" })
    }
  }
  return <button type="button" data-practice-question-copy="true" aria-label={t("문제 복사")}
    title={t(status === "error" ? "복사하지 못했습니다. 다시 시도해 주세요." : "문제 번호와 본문, 보기를 복사합니다.")}
    className="code-sandbox-button shrink-0" onClick={() => void copy()}>
    {status === "copied" ? <Check size={12} /> : <Copy size={12} />}
    <span role="status">{t(status === "copied" ? "복사됨" : status === "error" ? "복사 실패" : "복사")}</span>
  </button>
}
