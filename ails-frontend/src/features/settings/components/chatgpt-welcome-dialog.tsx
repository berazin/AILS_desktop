import { useEffect, useRef } from "react"
import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

export function ChatGPTWelcomeDialog({ onDismiss, busy }: { onDismiss: () => void; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); onDismiss() }}
    aria-labelledby="chatgpt-welcome-title" className="max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 text-[var(--foreground)] backdrop:bg-black/40">
    <h2 id="chatgpt-welcome-title" className="font-semibold">{t("ChatGPT 구독을 사용할 수 있습니다")}</h2>
    <p className="my-4 text-sm">{t("AI 설정에서 ChatGPT 구독을 선택한 요청은 연결된 계정의 구독 사용량을 사용합니다. 사용량과 앱 접근 권한은 ChatGPT 설정에서 관리할 수 있습니다. 기본 AI 선택은 그대로 유지됩니다.")}</p>
    <Button disabled={busy} onClick={onDismiss}>{t("확인")}</Button>
  </dialog>
}
