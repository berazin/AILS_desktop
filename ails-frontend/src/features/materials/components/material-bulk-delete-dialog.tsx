import { t } from "../../../lib/i18n.ts"
import type { MaterialBulkDeleteTarget } from "../hooks/use-materials-controller.ts"
import { MaterialDeleteDialog } from "./material-delete-dialog.tsx"

export function MaterialBulkDeleteDialog({ target, busy, onCancel, onConfirm }: {
  target: MaterialBulkDeleteTarget
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return <MaterialDeleteDialog
    busy={busy}
    confirmLabel={t("확인")}
    description={target.folders.length
      ? t("선택한 항목을 휴지통으로 이동합니다. 폴더 안의 파일과 하위 폴더도 함께 이동합니다.")
      : t("선택한 항목을 휴지통으로 이동합니다.")}
    onCancel={onCancel}
    onConfirm={onConfirm}
    summary={t("총 {p0}개 항목 (파일 {p1}개, 폴더 {p2}개)", {
      p0: target.files.length + target.folders.length, p1: target.files.length, p2: target.folders.length,
    })}
    title={t("선택 항목 삭제")}
    titleId="bulk-delete-title"
  />
}
