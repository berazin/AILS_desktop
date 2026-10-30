import { t } from "../../../lib/i18n.ts"
import { Button } from "../../../shared/ui/button.tsx"

export type ExpertFallbackChoice = "recommended" | "retry" | "cancel"

export interface ExpertFallbackPrompt {
  error: string
  selectedModel: string
  recommendedModel: string
}

export function ExpertFallbackDialog({
  onResolve,
  prompt,
  recommendedModelName,
  selectedModelName,
}: {
  onResolve: (choice: ExpertFallbackChoice) => void
  prompt: ExpertFallbackPrompt | null
  recommendedModelName: string
  selectedModelName: string
}) {
  if (!prompt) return null
  return (
    <div className="fixed inset-0 z-[155] flex items-center justify-center bg-black/55 p-4" data-ails-expert-fallback-dialog="true">
      <section
        aria-describedby="expert-fallback-description"
        aria-labelledby="expert-fallback-title"
        aria-modal="true"
        className="w-[min(480px,calc(100vw-32px))] rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
        role="dialog"
      >
        <h2 className="text-base font-semibold" id="expert-fallback-title">{t("복잡한 추론 모델을 호출하지 못했습니다")}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]" id="expert-fallback-description">{prompt.error}</p>
        <div className="mt-4 grid gap-2">
          <Button autoFocus onClick={() => onResolve("recommended")} type="button">
            {t("서버 추천 모델로 이번 요청만 재시도")}<span className="truncate text-xs opacity-75">{recommendedModelName}</span>
          </Button>
          <Button onClick={() => onResolve("retry")} type="button" variant="outline">
            {t("선택 모델로 다시 시도")}<span className="truncate text-xs opacity-75">{selectedModelName}</span>
          </Button>
          <Button onClick={() => onResolve("cancel")} type="button" variant="ghost">{t("취소")}</Button>
        </div>
      </section>
    </div>
  )
}
