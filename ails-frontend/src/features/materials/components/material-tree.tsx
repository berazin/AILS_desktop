import { memo, type ReactNode } from "react"

import type { LectureMaterialFolder } from "../../../lib/api"

type MaterialTreeProps = {
  folders: LectureMaterialFolder[]
  renderFolder: (folder: LectureMaterialFolder) => ReactNode
  renderKey: string
}

export const MaterialTree = memo(function MaterialTree({
  folders,
  renderFolder,
}: MaterialTreeProps) {
  if (folders.length === 0) return null
  return <div className="space-y-1">{folders.map(renderFolder)}</div>
})
