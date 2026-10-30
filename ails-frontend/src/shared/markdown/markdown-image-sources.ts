type Edit = {start:number; end:number; text:string; previewStart:number; previewEnd:number}

/** Repair only preview syntax. Source offsets and the user's file stay unchanged. */
export function normalizeMarkdownImageSources(source: string) {
  const edits: Edit[] = []
  let fence: {marker:string; length:number} | null = null
  let lineStart = 0
  for (const line of source.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = {marker:marker[0], length:marker.length}
      else if (marker[0] === fence.marker && marker.length >= fence.length) fence = null
      lineStart += line.length; continue
    }
    if (fence || /^(?: {4}|\t)/.test(line)) {lineStart += line.length; continue}
    const token = /(`+)([\s\S]*?)\1|!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(\s*(<[^>\n]*>|(?:[^()\n]|\([^()\n]*\))+)\)/g
    for (const match of line.matchAll(token)) {
      if (match[1]) continue
      let text = match[0]
      if (match[3]) {
        const [path, size] = match[3].split("|")
        const alt = path.replaceAll("\\", "/").split("/").at(-1) ?? "image"
        text = `![${alt}${size ? `|${size}` : ""}](<${path}>)`
      } else {
        const destination = match[5].trim()
        if (!destination.startsWith("<")) {
          const title = /^(.*?)(\s+(?:"[^"\n]*"|'[^'\n]*'))$/.exec(destination)
          const path = title?.[1] ?? destination
          if (/\s/.test(path)) text = `![${match[4]}](<${path}>${title?.[2] ?? ""})`
        }
      }
      if (text !== match[0]) edits.push({start:lineStart + match.index!, end:lineStart + match.index! + match[0].length, text, previewStart:0, previewEnd:0})
    }
    lineStart += line.length
  }
  let content = ""
  let previous = 0
  for (const edit of edits) {
    content += source.slice(previous, edit.start)
    edit.previewStart = content.length
    content += edit.text
    edit.previewEnd = content.length
    previous = edit.end
  }
  content += source.slice(previous)
  function sourceOffset(offset: number) {
    let delta = 0
    for (const edit of edits) {
      if (offset < edit.previewStart) break
      if (offset <= edit.previewEnd) {
        const fraction = (offset - edit.previewStart) / (edit.previewEnd - edit.previewStart)
        return edit.start + Math.round(fraction * (edit.end - edit.start))
      }
      delta += (edit.previewEnd - edit.previewStart) - (edit.end - edit.start)
    }
    return offset - delta
  }
  return {content, sourceOffset}
}
