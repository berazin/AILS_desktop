import { useContext } from "react"
import { mergeEvidence, type AnswerEvidence } from "../lib/answer-evidence.ts"
import { EvidenceNavigationContext } from "../lib/evidence-navigation-context.ts"

export function ChatAnswerEvidence({ evidence }: { evidence?: AnswerEvidence[] }) {
  const navigation = useContext(EvidenceNavigationContext)
  const sources = mergeEvidence(evidence ?? [])
  return <div className="mt-2 flex flex-wrap gap-2 text-xs" data-ails-answer-evidence>
    {sources.length ? <span className="text-[var(--muted-foreground)]">답변에 제공된 문서 근거 · PDF 파일 순서</span>
      : <span className="text-[var(--muted-foreground)]">확인 가능한 페이지 근거 없음</span>}
    {sources.map(source => <button key={source.id} type="button" title={`${source.path}${source.excerpt ? `\n${source.excerpt}` : ""}`}
      className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50"
      disabled={!navigation || navigation.busy || source.status !== "ready" || source.page_index === null}
      onClick={() => void navigation?.open(source)}>
      {sources.some(other => other.title === source.title && other.path !== source.path) ? source.path : source.title} · {source.page_index === null ? "페이지 정보 없음" : `PDF ${source.page_index + 1}쪽`}
    </button>)}
  </div>
}

export function EvidenceReturnBar() {
  const navigation = useContext(EvidenceNavigationContext)
  if (!navigation || (!navigation.canReturn && !navigation.status && !navigation.busy)) return null
  return <div className="fixed bottom-4 left-1/2 z-[100] max-w-[80vw] -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs shadow-lg" data-ails-evidence-return>
    {navigation.canReturn && <button type="button" disabled={navigation.busy} onClick={() => void navigation.back()} className="mr-3 font-semibold">읽던 위치로 돌아가기</button>}
    {navigation.cancel && <button type="button" onClick={navigation.cancel} className="mr-3 font-semibold">근거 이동 취소</button>}
    <span role="status">{navigation.status}</span>
  </div>
}
