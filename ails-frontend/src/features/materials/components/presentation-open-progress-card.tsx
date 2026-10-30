import { Loader2 } from "lucide-react"

import type { PresentationOpenProgress } from "../hooks/use-material-document-workflows.ts"
import { t } from "../../../lib/i18n.ts"
import { titleFromPath } from "../../../lib/viewer-document.ts"

export function PresentationOpenProgressCard({ progress }: { progress: PresentationOpenProgress }) {
  const stageText = progress.stage === "converting"
    ? t("PPT를 PDF로 변환하는 중...")
    : progress.stage === "finalizing"
      ? t("변환된 슬라이드를 여는 중...")
      : t("PPT/PPTX 열기를 준비하는 중...")

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[150] w-80 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-2xl"
      data-ails-presentation-progress="true"
      role="status"
    >
      <div className="flex items-center gap-2">
        <Loader2 className="animate-spin shrink-0 text-[var(--brand)]" size={15} />
        <p className="min-w-0 truncate text-sm font-semibold">{stageText}</p>
      </div>
      <p className="mt-2 truncate text-xs font-medium text-[var(--foreground)]">{titleFromPath(progress.path)}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">
        {t("{p0}초 경과.", { p0: progress.elapsedSeconds })}
        {progress.stage === "converting" && " "}
        {progress.stage === "converting" && t("처음 열 때만 변환하며 이후에는 저장된 PDF를 다시 사용합니다.")}
      </p>
      {progress.error && <p className="mt-1 break-words text-xs text-red-600">{progress.error}</p>}
    </div>
  )
}
