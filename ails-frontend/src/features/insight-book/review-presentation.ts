import type { Claim, Gate, InsightRun, RawInsight } from "./api.ts"

export type FeedbackItem = { label: string; text: string }
// Conservative equality only: never shorten formulas, discard qualifications or guess a legacy verdict.
export function sameText(left: string, right: string) {
  const key = (value: string) => value.trim().replace(/\s+/g, "").replace(/[.!?。]+$/, "")
  return Boolean(key(left)) && key(left) === key(right)
}

export function claimFeedback(claim: Claim, original: string, previousExtensions: string[] = []): FeedbackItem[] {
  const feedback = claim.feedback
  let items: FeedbackItem[]
  switch (claim.verdict) {
    case "VERIFIED": items = []; break
    case "PARTIALLY_CORRECT":
      items = [{ label: "수정이 필요한 부분", text: feedback?.correction ?? claim.corrected }]; break
    case "INCORRECT":
      items = [{ label: "틀린 이유", text: feedback?.reason ?? claim.explanation },
        { label: "올바른 개념", text: feedback?.concept ?? claim.corrected }]; break
    case "UNCERTAIN":
      items = [{ label: "불확실한 부분", text: feedback?.uncertainty ?? claim.explanation },
        { label: "추가 확인 사항", text: feedback?.check ?? (claim.extension?.trim() || "주장의 조건이나 근거 자료를 보완해 다시 검증하세요.") }]; break
  }
  const extension = (feedback ? feedback.extension : claim.extension)?.trim()
  if ((claim.verdict === "VERIFIED" || claim.verdict === "PARTIALLY_CORRECT") && extension
      && ![original, claim.text, claim.summary || "", claim.corrected, ...items.map(item => item.text), ...previousExtensions].some(value => sameText(extension, value))) {
    items.push({ label: "더 나아가기", text: extension })
  }
  return items.filter(item => item.text?.trim())
}

export function gateFeedback(gate: Gate, original: string) {
  const extensions: string[] = []
  return gate.claims.map(claim => {
    const items = claimFeedback(claim, original, extensions)
      .filter(item => item.label !== "더 나아가기" || !gate.claims.some(other => sameText(item.text, other.text)))
    extensions.push(...items.filter(item => item.label === "더 나아가기").map(item => item.text))
    return items
  })
}

export function reviewComplete(raw: RawInsight, run?: InsightRun) {
  if (raw.review_status) return raw.review_status !== "pending"
  return run?.state === "done" && (run.gate?.verdict === "VERIFIED" || Boolean(run.accepted_correction))
    && (run.outcome === "committed" || run.outcome === "already_covered")
}
