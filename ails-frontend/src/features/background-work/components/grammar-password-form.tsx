import { useState } from "react"
import { t } from "../../../lib/i18n.ts"
import { submitGrammarRefinementPassword } from "../../../lib/api/background-work.ts"
import { Button } from "../../../shared/ui/button.tsx"
import { Input } from "../../../shared/ui/input.tsx"

export function GrammarPasswordForm({ path, onSubmitted }: { path: string; onSubmitted: () => void }) {
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  return (
    <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={async (event) => {
      event.preventDefault()
      if (pending) return
      setPending(true)
      setError("")
      try {
        await submitGrammarRefinementPassword(path, password)
        setPassword("")
        onSubmitted()
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : t("비밀번호를 제출하지 못했습니다."))
      } finally {
        setPending(false)
      }
    }}>
      <Input
        type="password"
        autoComplete="off"
        aria-label={t("PDF 비밀번호")}
        placeholder={t("PDF 비밀번호")}
        className="h-8 w-44 text-xs"
        value={password}
        disabled={pending}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? t("제출 중") : t("문법정제 재개")}
      </Button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </form>
  )
}
