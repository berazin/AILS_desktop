import { useState, type FormEvent } from "react"

import type { LectureMaterialFolder, LectureMaterialsPayload, LectureMaterialTrashItem } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"

type FolderChoice = { path: string; label: string }

function folderChoices(materials: LectureMaterialsPayload): FolderChoice[] {
  const result = [{ path: materials.base_path, label: t("학습 자료") }]
  const visit = (folder: LectureMaterialFolder, prefix: string) => {
    const label = prefix ? `${prefix} / ${folder.name}` : folder.name
    result.push({ path: folder.path, label })
    for (const child of folder.children ?? []) visit(child, label)
  }
  for (const folder of materials.folders) visit(folder, "")
  return result
}

export function MaterialTrashRestoreDialog({
  busy,
  materials,
  onCancel,
  onConfirm,
  target,
}: {
  busy: boolean
  materials: LectureMaterialsPayload
  onCancel: () => void
  onConfirm: (folderPath: string, name: string) => void
  target: LectureMaterialTrashItem
}) {
  const folders = folderChoices(materials)
  const originalFolder = folders.find((folder) => folder.path.toLowerCase() === target.original_parent?.toLowerCase())
  const [folderPath, setFolderPath] = useState(originalFolder?.path ?? materials.base_path)
  const [name, setName] = useState(target.original_name ?? "")

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!folderPath || !trimmed) return
    onConfirm(folderPath, trimmed)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4" role="presentation">
      <form aria-labelledby="material-trash-restore-title" className="w-full max-w-md space-y-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl" onSubmit={submit}>
        <h2 className="text-base font-semibold" id="material-trash-restore-title">{t("자료 복원")}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{t("복원할 위치와 이름을 확인하세요.")}</p>
        <label className="block space-y-1 text-sm">
          <span>{t("폴더")}</span>
          <select className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-2" onChange={(event) => setFolderPath(event.target.value)} value={folderPath}>
            {folders.map((folder) => <option key={folder.path} value={folder.path}>{folder.label}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("이름")}</span>
          <input autoFocus className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-2" onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        {!target.original_name && <p className="text-xs text-[var(--muted-foreground)]">{t("기존 휴지통 항목은 원래 이름을 알 수 없습니다. 파일 확장자를 포함해 입력하세요.")}</p>}
        <div className="flex justify-end gap-2">
          <button className="rounded-lg px-3 py-2 text-sm hover:bg-[var(--muted)]" disabled={busy} onClick={onCancel} type="button">{t("취소")}</button>
          <button className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50" disabled={busy || !folderPath || !name.trim()} type="submit">{t("복원")}</button>
        </div>
      </form>
    </div>
  )
}
