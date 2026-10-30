import { t } from "../../../lib/i18n.ts"
import { useEffect, useState } from "react"
import { Copy, Loader2, MessageSquare, Send, X } from "lucide-react"

import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"
import { Textarea } from "../../../shared/ui/textarea.tsx"
import { submitFeedback } from "../../../lib/api"
import { useFeedbackEnvironment } from "../hooks/use-feedback-environment.ts"
import { feedbackBody, formatFeedbackEnvironment } from "../lib/feedback-environment.ts"

export type FeedbackCategory = "bug" | "feature" | "usability" | "ai_output" | "other"

interface FeedbackDialogProps {
  open: boolean
  onClose: () => void
}

const CATEGORY_OPTIONS: Array<{ id: FeedbackCategory; label: string }> = [
  { id: "bug", label: t(t("오류")) },
  { id: "feature", label: t(t("기능 제안")) },
  { id: "usability", label: t(t("사용성")) },
  { id: "ai_output", label: t(t("부적절한 AI 출력")) },
  { id: "other", label: t(t("기타")) },
]

export function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
  const [category, setCategory] = useState<FeedbackCategory>("bug")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [includeEnvironment, setIncludeEnvironment] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const diagnostics = useFeedbackEnvironment(open && includeEnvironment)

  useEffect(() => {
    if (!open) return
    setError("")
    setCopied(false)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose, open])

  if (!open) return null

  async function submit() {
    if (busy || !title.trim() || !description.trim()) return
    setBusy(true)
    setError("")
    try {
      const issueBody = feedbackBody(description, includeEnvironment ? await diagnostics.refresh() : null)
      await submitFeedback({ category, title: title.trim(), body: issueBody })
      setCategory("bug")
      setTitle("")
      setDescription("")
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setBusy(false)
    }
  }

  async function copyFeedback() {
    try {
      const issueBody = feedbackBody(description, includeEnvironment ? await diagnostics.refresh() : null)
      await navigator.clipboard.writeText(`${title.trim()}\n\n${issueBody}`)
      setCopied(true)
      setError("")
      window.setTimeout(() => setCopied(false), 1800)
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : t(t("클립보드에 복사하지 못했습니다.")))
    }
  }

  return (
    <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <section className="flex max-h-[calc(100dvh-32px)] w-[min(620px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="text-[var(--brand)]" size={17} />
            <div>
              <h2 className="text-sm font-semibold">{t(t("개발자에게 피드백"))}</h2>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                {t(t("로그인한 계정과 작성 내용이 support@ailstudio.org으로 바로 전송됩니다."))}</p>
            </div>
          </div>
          <Button aria-label={t(t("피드백 창 닫기"))} onClick={onClose} size="icon" type="button" variant="ghost">
            <X size={16} />
          </Button>
        </header>

        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          <div>
            <div className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">{t(t("유형"))}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CATEGORY_OPTIONS.map((option) => (
                <button
                  className={`min-h-9 rounded-md border px-3 py-2 text-xs font-semibold ${category === option.id ? "border-[var(--brand)] bg-[var(--brand)] text-white" : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"}`}
                  key={option.id}
                  onClick={() => setCategory(option.id)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="grid gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
            {t(t("제목"))}<Input maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder={t(t("문제를 간단히 요약하세요"))} value={title} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[var(--muted-foreground)]">
            {t(t("내용"))}<Textarea className="min-h-44 resize-y" maxLength={4000} onChange={(event) => setDescription(event.target.value)} placeholder={t(t("발생 과정, 기대한 동작, 실제 동작을 작성하세요"))} value={description} />
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
            <input checked={includeEnvironment} disabled={busy} className="h-4 w-4 accent-[var(--brand)]" onChange={(event) => setIncludeEnvironment(event.target.checked)} type="checkbox" />
            {t(t("앱 버전과 실행 환경 포함"))}</label>
          {includeEnvironment && <div className="space-y-2 text-xs text-[var(--muted-foreground)]">
            <p>{t("OS·화면·하드웨어·앱 정보가 포함됩니다. 파일 경로·내용과 인증 정보는 수집하지 않습니다.")}</p>
            {diagnostics.loading && <p role="status">{t("환경 정보 확인 중")}</p>}
            {diagnostics.environment && <details className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3">
              <summary className="cursor-default font-medium">{t("전송할 환경 정보")}</summary>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5" data-ails-feedback-environment>{formatFeedbackEnvironment(diagnostics.environment)}</pre>
            </details>}
          </div>}

          {error && <div className="rounded-md border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-500">{error}</div>}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4">
          <Button disabled={busy || (includeEnvironment && diagnostics.loading)} onClick={() => void copyFeedback()} type="button" variant="outline">
            <Copy size={14} /> {copied ? t(t("복사됨")) : t(t("내용 복사"))}
          </Button>
          <div className="flex items-center gap-2">
            <Button onClick={onClose} type="button" variant="ghost">{t(t("취소"))}</Button>
            <Button disabled={busy || (includeEnvironment && diagnostics.loading) || !title.trim() || !description.trim()} onClick={() => void submit()} type="button">
              {busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
              {t(t("피드백 보내기"))}</Button>
          </div>
        </footer>
      </section>
    </div>
  )
}
