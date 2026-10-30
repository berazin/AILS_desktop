import { useEffect, useLayoutEffect, useRef, type RefObject, type Dispatch, type SetStateAction } from "react"
import type { ReadingLocation } from "../../chat/hooks/use-answer-evidence-navigation.ts"
import { savePdfPageForPath } from "../lib/pdf-page-state.ts"
import { restoreEvidenceScroll } from "../lib/evidence-scroll.ts"

const key = (path: string) => path.replace(/\\/g, "/").toLowerCase()
type Document = { id: string; file_path: string; page_count?: number; loading?: boolean }

export function useEvidenceDocumentNavigation(options: {
  document: Document | null
  currentPage: number
  openFile: (path: string) => Promise<void>
  setPages: Dispatch<SetStateAction<Record<string, number>>>
  scrollRef: RefObject<HTMLElement | null>
}) {
  const live = useRef(options)
  useLayoutEffect(() => { live.current = options })
  const pending = useRef<{ cancel: () => void } | null>(null)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++; pending.current?.cancel() }, [])

  async function navigate(location: ReadingLocation) {
    pending.current?.cancel()
    const request = ++generation.current
    await live.current.openFile(location.path)
    if (request !== generation.current) throw new Error("페이지 이동이 취소되었습니다.")
    return new Promise<void>((resolve, reject) => {
      let frame = 0
      let count = 0
      let applied = false
      let painted = 0
      const finish = (error?: Error) => {
        cancelAnimationFrame(frame)
        pending.current = null
        if (error) reject(error)
        else resolve()
      }
      pending.current = { cancel: () => finish(new Error("페이지 이동이 취소되었습니다.")) }
      const tick = () => {
        const current = live.current
        if (request !== generation.current || (applied && current.document && key(current.document.file_path) !== key(location.path))) {
          finish(new Error("문서가 전환되어 페이지 이동을 취소했습니다.")); return
        }
        if (++count > 600) { finish(new Error("PDF 열기 완료를 확인하지 못했습니다.")); return }
        if (current.document && !current.document.loading && key(current.document.file_path) === key(location.path)) {
          if (!applied) {
            applied = true
            const pathKey = location.path.replace(/\\/g, "/")
            current.setPages(pages => ({ ...pages, [current.document!.id]: location.page, [pathKey]: location.page }))
            savePdfPageForPath(pathKey, location.page)
          }
          if (current.currentPage === location.page && current.scrollRef.current) {
            const element = current.scrollRef.current
            const rendered = [...element.querySelectorAll<HTMLElement>('[data-pdf-page-number]')].some(page =>
              Number(page.dataset.pdfPageNumber) === location.page && key(page.dataset.pdfSourcePath ?? '') === key(location.path) && page.querySelector('canvas'))
            if (!rendered) { frame = requestAnimationFrame(tick); return }
            restoreEvidenceScroll(element, location.innerScroll)
            element.scrollTop = location.scrollTop
            element.scrollLeft = location.scrollLeft
            // Give PDF layout a few frames to restore its content height.
            if (++painted >= 4 && (element.scrollTop === location.scrollTop || painted > 60)) { finish(); return }
          }
        }
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })
  }
  return { navigate, cancel: () => { generation.current++; pending.current?.cancel() } }
}
