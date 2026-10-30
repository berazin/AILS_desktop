import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { requestJson } from "../../../lib/api/core.ts"
import type { AnswerEvidence } from "../lib/answer-evidence.ts"
import type { EvidenceNavigation } from "../lib/evidence-navigation-context.ts"

export type ReadingLocation = { path: string; page: number; scrollTop: number; scrollLeft: number; innerScroll?: { top: number; left: number }[] }
type Resolution = { status: string; reason?: string; path: string; page: number; page_label?: string; revision: string; position_reason?: string; position?: { space: string; boxes: number[][] } }

/** A single excursion baseline survives consecutive citations; the browser history is untouched. */
export function useAnswerEvidenceNavigation(options: {
  capture: () => ReadingLocation | null
  navigate: (location: ReadingLocation) => Promise<void>
  cancel?: () => void
}) {
  const live = useRef(options)
  useLayoutEffect(() => { live.current = options })
  const origin = useRef<{ location: ReadingLocation; evidence: AnswerEvidence } | null>(null)
  const inFlight = useRef(false)
  const generation = useRef(0)
  useEffect(() => () => { generation.current++; live.current.cancel?.() }, [])
  const [busy, setBusy] = useState(false)
  const [canReturn, setCanReturn] = useState(false)
  const [status, setStatus] = useState("")
  const [highlight, setHighlight] = useState<EvidenceNavigation["highlight"]>()
  const resolve = (evidence: AnswerEvidence) => requestJson<Resolution>("/chatbot/evidence/resolve", {
    method: "POST", body: JSON.stringify({ evidence }),
  })
  function cancel() {
    generation.current++
    live.current.cancel?.()
    inFlight.current = false
    origin.current = null
    setBusy(false)
    setCanReturn(false)
    setHighlight(undefined)
    setStatus("")
  }
  async function run(action: (ticket: number) => Promise<void>) {
    if (inFlight.current) return
    const ticket = ++generation.current
    inFlight.current = true
    setBusy(true)
    try { await action(ticket) } catch (error) { if (ticket === generation.current) setStatus(error instanceof Error ? error.message : String(error)) }
    finally { if (ticket === generation.current) { inFlight.current = false; setBusy(false) } }
  }
  async function open(evidence: AnswerEvidence) {
    return run(async ticket => {
      const location = live.current.capture()
      setHighlight(undefined)
      const target = await resolve(evidence)
      if (ticket !== generation.current) return
      if (target.status !== "ready") { setStatus(target.reason ?? "근거를 확인할 수 없습니다."); return }
      if (live.current.capture()?.path !== location?.path) { setStatus("문서가 전환되어 근거 이동을 취소했습니다."); return }
      // Capture before any navigation, once per excursion. No stale React state race.
      if (!origin.current && location) {
        const result = await requestJson<{ evidence: AnswerEvidence[] }>("/chatbot/evidence/anchor", {
          method: "POST", body: JSON.stringify(location),
        })
        if (ticket !== generation.current) return
        if (result.evidence[0]) origin.current = { location, evidence: result.evidence[0] }
      }
      setCanReturn(Boolean(origin.current))
      if (live.current.capture()?.path !== location?.path) { setStatus("문서가 전환되어 근거 이동을 취소했습니다."); return }
      await live.current.navigate({ path: target.path, page: target.page, scrollTop: 0, scrollLeft: 0 })
      if (ticket !== generation.current) return
      const verified = await resolve(evidence)
      if (ticket !== generation.current) return
      if (live.current.capture()?.path.replace(/\\/g, "/").toLowerCase() !== target.path.replace(/\\/g, "/").toLowerCase()) { setStatus("문서가 전환되어 문장 강조를 취소했습니다."); return }
      if (verified.status !== "ready") { setStatus(verified.reason ?? "원문이 변경되어 강조하지 않았습니다."); return }
      if (verified.position?.space === "pdf") setHighlight({ path: target.path, page: target.page, boxes: verified.position.boxes, revision: verified.revision, expires: Date.now() + 10000 })
      setStatus(`PDF ${target.page}쪽${target.page_label && target.page_label !== String(target.page) ? ` · 문서 페이지 라벨 ${target.page_label}` : ""} · ${target.position_reason ?? "페이지로 이동했습니다."}`)
    })
  }
  async function back() {
    return run(async ticket => {
      const saved = origin.current
      if (!saved) return
      setHighlight(undefined)
      const target = await resolve(saved.evidence)
      if (ticket !== generation.current) return
      if (target.status !== "ready") { setStatus(`원위치 복귀 불가: ${target.reason}`); return }
      await live.current.navigate(saved.location)
      if (ticket !== generation.current) return
      origin.current = null
      setCanReturn(false)
      setStatus("")
    })
  }
  return { open, back, canReturn, busy, status, highlight, cancel }
}
