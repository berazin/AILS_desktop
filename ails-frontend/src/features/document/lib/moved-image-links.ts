const CODE = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$|`[^`\n]+`/gm
const IMAGES = /(?<markdownPrefix>!\[[^\]\n]*\]\(\s*)(?<markdown><[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+?)\s*(?:"[^"\n]*"|'[^'\n]*')?\s*\)|(?<obsidianPrefix>!\[\[)(?<obsidian>[^\]|\n]+)(?:\|[^\]\n]*)?\]\]|(?<htmlPrefix><img\b[^>]*?\bsrc=["'])(?<html>[^"']+)["']/gi

// Apply the backend's path changes to a draft without replacing the user's text.
export function rewriteMovedImageSources(content: string, replacements: Array<{ before: string; after: string }>) {
  const paths = new Map(replacements.map((item) => [item.before, item.after]))
  const masked = content.replace(CODE, (value) => " ".repeat(value.length))
  const changes: Array<{ start: number; end: number; value: string }> = []
  for (const match of masked.matchAll(IMAGES)) {
    const groups = match.groups!
    const kind = groups.markdown ? "markdown" : groups.obsidian ? "obsidian" : "html"
    const source = groups[kind]
    let start = match.index + groups[`${kind}Prefix`].length
    let end = start + source.length
    if (kind === "markdown" && source.startsWith("<")) {
      start += 1
      end -= 1
    }
    const replacement = paths.get(content.slice(start, end))
    if (replacement !== undefined) changes.push({ start, end, value: replacement })
  }
  for (const { start, end, value } of changes.reverse()) {
    content = content.slice(0, start) + value + content.slice(end)
  }
  return content
}
