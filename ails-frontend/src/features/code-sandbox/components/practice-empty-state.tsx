import { ClipboardList, Loader2 } from "lucide-react"
import { t } from "../../../lib/i18n.ts"

export function PracticeEmptyState({ loading, loadingLabel, error }: { loading: boolean; loadingLabel?: string; error: string }) {
  return <div data-practice-empty-state="true" className="flex min-h-0 flex-1 items-center justify-center bg-[var(--panel)] p-6 text-center">
    <div className="max-w-sm text-sm" role={error ? "alert" : "status"}>
      {loading ? <Loader2 size={24} className="mx-auto mb-3 animate-spin text-[var(--muted-foreground)]" />
        : <ClipboardList size={24} className="mx-auto mb-3 text-[var(--muted-foreground)]" />}
      <p className="font-medium">{loading ? loadingLabel ?? t("문제 준비 중") : error ? t("문제풀이를 불러오지 못했습니다") : t("현재 PDF에서 인식된 문제가 없습니다.")}</p>
      <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">{error || (loading ? "" : t("PDF의 OCR과 문제 분석이 완료되면 여기에 표시됩니다."))}</p>
    </div>
  </div>
}
