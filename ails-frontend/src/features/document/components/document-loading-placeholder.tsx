import { t } from "../../../lib/i18n.ts"
import { Loader2 } from "lucide-react"

export function DocumentLoadingPlaceholder() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="flex items-center gap-2 p-6 text-sm text-[var(--muted-foreground)]">
      <span aria-hidden="true" className="inline-flex shrink-0 animate-spin will-change-transform motion-reduce:animate-none">
        <Loader2 size={18} />
      </span>
      {t("문서를 불러오는 중...")}
    </div>
  )
}
