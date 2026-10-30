import type { LocalAiModel } from "../../../lib/api/local-ai.ts"

export const LOCAL_AI_EXCLUDED_NAME_KEYWORDS = [
  "distill", "distilled", "uncensored", "unsensored", "abliterated",
  "base", "pretrained", "merge", "merged", "finetune", "fine-tuned", "finetuned",
] as const

const separator = "[^\\p{L}\\p{N}]"
const keywords = LOCAL_AI_EXCLUDED_NAME_KEYWORDS.map(keyword => keyword.split("-").join(`${separator}+`))
const excludedName = new RegExp(`(?:^|${separator})(?:${keywords.join("|")})(?=$|${separator})`, "iu")

// Match whole name components, including fine-tuned / fine_tuned / fine.tuned.
export function isDefaultLocalAiRecommendation(model: Pick<LocalAiModel, "catalog_id">): boolean {
  return !excludedName.test(model.catalog_id)
}
