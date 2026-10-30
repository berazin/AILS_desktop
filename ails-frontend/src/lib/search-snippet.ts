// Split the FTS match markers into text segments; never interpret other HTML.
export interface SnippetSegment {
  text: string
  highlighted: boolean
}

export function snippetSegments(snippet: string): SnippetSegment[] {
  return String(snippet || "").split(/<\/?mark>/)
    .map((text, index) => ({ text, highlighted: index % 2 === 1 }))
    .filter(segment => segment.text.length > 0)
}
