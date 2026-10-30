import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react"
import { getLectureMaterials, type LectureMaterialsPayload } from "../../../lib/api"
import { t } from "../../../lib/i18n.ts"

/** Publish root rows before starting the recursive catalog/metadata refresh. */
export function useMaterialCatalog(setNotice: (message: string) => void) {
  const [storedLectureMaterials, setSnapshot] = useState<LectureMaterialsPayload | null>(null)
  const pending = useRef<{ revision: number; controller?: AbortController; timer?: ReturnType<typeof setTimeout> }>({ revision: 0 })
  const cancel = useCallback(() => {
    pending.current.revision++
    pending.current.controller?.abort()
    clearTimeout(pending.current.timer)
    pending.current.timer = undefined
  }, [])
  useEffect(() => cancel, [cancel])
  const setLectureMaterials = useCallback((value: SetStateAction<LectureMaterialsPayload | null>) => {
    cancel()
    setSnapshot(value)
  }, [cancel])
  const refreshLectureMaterials = useCallback(async () => {
    cancel()
    const revision = pending.current.revision
    const controller = new AbortController()
    pending.current.controller = controller
    try {
      const rows = await getLectureMaterials({ directory: "", signal: controller.signal })
      if (controller.signal.aborted || revision !== pending.current.revision) return
      setSnapshot(rows)
      // A one-shot delay leaves the first paint and visible-folder requests ahead
      // of descendant scans, practice metadata, trash and indexing preparation.
      if (rows.shallow) pending.current.timer = setTimeout(() => {
        void getLectureMaterials({ signal: controller.signal }).then((catalog) => {
          if (!controller.signal.aborted && revision === pending.current.revision) setSnapshot(catalog)
        }).catch((error: unknown) => {
          if (controller.signal.aborted || revision !== pending.current.revision) return
          setNotice(t("하위 자료 정보를 갱신하지 못했습니다: {p0}", { p0: error instanceof Error ? error.message : String(error) }))
        })
      }, 150)
    } catch (error) {
      if (controller.signal.aborted || revision !== pending.current.revision) return
      setNotice(t("강의자료를 불러오지 못했습니다: {p0}", { p0: error instanceof Error ? error.message : String(error) }))
    }
  }, [cancel, setNotice])
  return { storedLectureMaterials, setLectureMaterials, refreshLectureMaterials }
}
