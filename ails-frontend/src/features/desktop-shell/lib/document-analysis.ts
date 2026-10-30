// 열려 있는 문서의 내용(OCR/추출 텍스트)을 분석해 프로세스바 버튼 표시 조건을
// 계산한다. 번역 버튼은 문서 언어가 UI 언어와 다를 때, 코드 버튼은 프로그래밍
// 언어가 감지될 때, OCR 버튼은 텍스트 레이어가 없을 때 노출한다.

import type { ViewerDocument } from "../../../lib/viewer-document.ts"

export type UiLanguageCode = "korean" | "english" | "japanese" | "chinese"

export type DocumentFeatureHints = {
  codeLanguage: string
  hasText: boolean
  language: UiLanguageCode | ""
  needsOcr: boolean
}

const HANGUL_RE = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g
const KANA_RE = /[\u3040-\u30FF\u31F0-\u31FF]/g
const HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g
const LATIN_RE = /[A-Za-z]/g

// 이 값 미만의 문자 수는 표지·빈 페이지 노이즈로 보고 판정하지 않는다.
const MIN_LETTER_COUNT = 12
const MIN_TEXT_CHARS = 40

function countMatches(text: string, pattern: RegExp) {
  const matches = text.match(pattern)
  return matches ? matches.length : 0
}

export function detectDocumentLanguage(texts: readonly string[]): UiLanguageCode | "" {
  let hangul = 0
  let kana = 0
  let han = 0
  let latin = 0
  for (const text of texts) {
    if (!text) continue
    hangul += countMatches(text, HANGUL_RE)
    kana += countMatches(text, KANA_RE)
    han += countMatches(text, HAN_RE)
    latin += countMatches(text, LATIN_RE)
  }
  const total = hangul + kana + han + latin
  if (total < MIN_LETTER_COUNT) return ""
  if (kana >= Math.max(2, total * 0.02)) return "japanese"
  if (hangul >= Math.max(2, total * 0.05)) return "korean"
  if (han >= Math.max(2, total * 0.05)) return "chinese"
  if (latin >= total * 0.5) return "english"
  return ""
}

// 정규식에 g 플래그를 재사용하면 lastIndex가 남으므로 매번 새로 만든다.
const CODE_SIGNATURES: readonly (readonly [string, readonly string[]])[] = [
  [
    "Python",
    [
      "\\bdef\\s+\\w+\\s*\\(",
      "\\bfrom\\s+[\\w.]+\\s+import\\b",
      "\\bimport\\s+(os|sys|re|math|json|numpy|pandas|torch|tensorflow)\\b",
      "\\bprint\\s*\\(",
      "__\\w+__",
      "\\bself\\.\\w+",
      "\\belif\\b",
    ],
  ],
  [
    "C/C++",
    [
      "#include\\s*[<\"]",
      "\\bint\\s+main\\s*\\(",
      "\\bstd::\\w+",
      "\\bprintf\\s*\\(",
      "\\bcout\\s*<<",
      "\\bnullptr\\b",
      "\\bstruct\\s+\\w+\\s*\\{",
    ],
  ],
  [
    "Java",
    [
      "\\bpublic\\s+static\\s+void\\s+main\\b",
      "\\bSystem\\.out\\.print",
      "\\bprivate\\s+\\w+\\s+\\w+\\s*[;{]",
      "\\bnew\\s+\\w+\\s*\\(\\)\\s*;",
      "\\bextends\\s+\\w+\\s*\\{",
    ],
  ],
  [
    "C#",
    [
      "\\busing\\s+System\\b",
      "\\bpublic\\s+class\\s+\\w+",
      "\\bConsole\\.Write",
      "\\bnamespace\\s+[\\w.]+",
    ],
  ],
  [
    "JavaScript",
    [
      "\\bfunction\\s+\\w*\\s*\\(",
      "\\bconsole\\.log\\s*\\(",
      "\\bconst\\s+\\w+\\s*=",
      "=>\\s*\\{?",
      "\\bdocument\\.\\w+",
      "\\bmodule\\.exports\\b",
    ],
  ],
  [
    "TypeScript",
    [
      ":\\s*(string|number|boolean)\\b",
      "\\binterface\\s+\\w+\\s*\\{",
      "\\bexport\\s+(const|function|class)\\b",
      "\\btype\\s+\\w+\\s*=",
    ],
  ],
  [
    "Go",
    [
      "\\bpackage\\s+main\\b",
      "\\bfunc\\s+\\w+\\s*\\(",
      "\\bfmt\\.Print",
      "\\bgo\\s+func\\b",
    ],
  ],
  [
    "Rust",
    [
      "\\bfn\\s+\\w+\\s*\\(",
      "\\blet\\s+mut\\b",
      "\\bprintln!\\s*\\(",
      "::\\w+::",
    ],
  ],
]

const CODE_LINE_RE = /^\s*(?:\w+\s+)?(?:\w+\s*=\s*[\w("(]|\}|return\b|while\b|for\b|if\b|else\b|elif\b|echo\b)/

export function detectCodeLanguage(texts: readonly string[]): string {
  const sample = texts.join("\n")
  if (!sample) return ""
  let bestLanguage = ""
  let bestScore = 0
  for (const [language, patterns] of CODE_SIGNATURES) {
    let score = 0
    for (const pattern of patterns) {
      const regex = new RegExp(pattern)
      if (regex.test(sample)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      bestLanguage = language
    }
  }
  if (bestScore >= 2) return bestLanguage
  // 어느 언어로도 특정되지 않아도 코드처럼 생긴 줄이 많으면 일반 코드로 본다.
  const lines = sample.split("\n")
  const codeLines = lines.filter((line) => CODE_LINE_RE.test(line)).length
  if (codeLines >= 5) return bestLanguage || "코드"
  return ""
}

export function analyzeDocumentFeatures(document: ViewerDocument | null): DocumentFeatureHints {
  const pageTexts = (document?.page_texts ?? []).filter((text) => Boolean(text && text.trim()))
  const texts = pageTexts.length > 0 ? pageTexts : document?.content ? [document.content] : []
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0)
  const hasText = totalChars >= MIN_TEXT_CHARS
  const extractionInFlight =
    document?.text_extraction_status === "pending" || document?.text_extraction_status === "extracting"
  const needsOcr =
    document?.kind === "pdf" && !extractionInFlight && !hasText
  return {
    codeLanguage: hasText ? detectCodeLanguage(texts) : "",
    hasText,
    language: hasText ? detectDocumentLanguage(texts) : "",
    needsOcr,
  }
}
