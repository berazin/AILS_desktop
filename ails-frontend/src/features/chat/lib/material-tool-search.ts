import type { VoiceMaterialTarget } from "../../../lib/material-navigation.ts"

const compact = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
const COURSE_ALIASES: Record<string, string[]> = {
  oss: ["오픈소스소프트웨어", "open source software"],
}
const WEEK = /(\d+)\s*주(?:차)?[\s_-]*(?:(\d+)\s*(?:차시|강|회|차|번)?)?|\b(?:week|w)\s*(\d+)(?:\s*[-_ ]\s*(\d+))?/i

export function materialRequestQuery(request: string): string {
  return request.normalize("NFKC").trim()
    .replace(/의(?=\s*\d+\s*주)/g, " ")
    .replace(/^(?:please\s+)?open\s+/i, "")
    .replace(/^(?:그럼|그러면|아니|제발)\s+/, "")
    .replace(/(?:을|를)?\s*(?:열어(?:봐|줘|주세요|라|라고)?|열라고|열기|보여(?:줘|주세요)|띄워(?:줘|주세요))\s*[.!?]*$/, "")
    .replace(/(?:학습자료|자료|파일)(?:을|를)?\s*$/, "")
    .trim()
}

function weekPosition(text: string) {
  const match = text.match(WEEK)
  if (!match) return null
  return { week: Number(match[1] || match[3]), session: Number(match[2] || match[4]) || null }
}

function queryParts(query: string) {
  const position = weekPosition(query)
  const words = materialRequestQuery(query).replace(WEEK, " ").split(/[\s_/,]+/u)
    .map(compact).filter(Boolean)
  return { position, words }
}

function matchScore(target: VoiceMaterialTarget, query: string): number {
  const { position, words } = queryParts(query)
  const filename = target.path.replace(/\\/g, "/").split("/").at(-1) || ""
  // Prefer filename/title for the session, with folder metadata supplying a week.
  const actual = weekPosition(`${target.title} ${filename}`) || weekPosition(target.folder)
  if (position && (!actual || actual.week !== position.week || (position.session && actual.session !== position.session))) return 0
  const title = compact(target.title)
  const file = compact(filename)
  const folder = compact(target.folder)
  const englishNames = `${target.title} ${target.folder}`.match(/[a-z]+(?:[ -]+[a-z]+)+/gi) || []
  const acronyms = englishNames.map(name => name.toLowerCase().split(/[ -]+/).map(word => word[0]).join(""))
  let score = position ? 100 : 0
  for (const word of words) {
    const alternatives = [word, ...(COURSE_ALIASES[word] || []).map(compact)]
    if (alternatives.some(term => title.includes(term))) score += 50
    else if (alternatives.some(term => file.includes(term))) score += 40
    else if (alternatives.some(term => folder.includes(term)) || acronyms.includes(word)) score += 30
    else return 0
  }
  return score
}

export function matchingMaterialTargets(targets: VoiceMaterialTarget[], query: string): VoiceMaterialTarget[] {
  if (!materialRequestQuery(query)) return targets
  return targets.map((target, index) => ({ target, index, score: matchScore(target, query) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.target)
}

export function materialSearchPage(targets: VoiceMaterialTarget[], arguments_: Record<string, unknown>) {
  const query = String(arguments_.query || "").trim().slice(0, 240)
  const matches = matchingMaterialTargets(targets, query)
  const offset = Math.max(0, Math.trunc(Number(arguments_.offset) || 0))
  const limit = Math.min(20, Math.max(1, Math.trunc(Number(arguments_.limit) || 10)))
  const items = matches.slice(offset, offset + limit)
  return {
    query, total: matches.length, library_total: targets.length, offset,
    has_more: offset + items.length < matches.length,
    next_offset: offset + items.length < matches.length ? offset + items.length : null,
    materials: items.map(({ candidate_id, title, folder, kind }) => ({ candidate_id, title, folder, kind })),
  }
}
