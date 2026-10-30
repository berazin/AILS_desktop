import { ChevronLeft, ChevronRight } from "lucide-react"
import { t } from "../../../lib/i18n.ts"
import type { PracticePdfFileControls } from "../hooks/use-practice-pdf-files.ts"

export function PracticePdfFileButtons({ controls }: { controls: PracticePdfFileControls }) {
  return <>
    {([-1, 1] as const).map((direction) => {
      const target = direction === -1 ? controls.previous : controls.next
      const label = direction === -1 ? t("이전 PDF 파일") : t("다음 PDF 파일")
      const Icon = direction === -1 ? ChevronLeft : ChevronRight
      return <button aria-label={label} className="code-sandbox-button" data-practice-pdf-file-direction={direction}
        disabled={controls.busy || !target} key={direction} onClick={() => void controls.open(direction)}
        title={target ? `${label}: ${target.fileName || target.title}` : label} type="button">
        <Icon size={13} />
      </button>
    })}
  </>
}
