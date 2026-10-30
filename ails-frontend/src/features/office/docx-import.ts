import JSZip from 'jszip'
import mammoth from 'mammoth'
import DOMPurify from 'dompurify'

function sanitize(html: string) {
  const document = new DOMParser().parseFromString(DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'iframe', 'object', 'embed'], FORBID_ATTR: ['srcset'] }), 'text/html')
  document.querySelectorAll('img').forEach(img => { if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(img.src)) img.remove() })
  return document.body.innerHTML
}

export async function importDocx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const mainXml = await zip.file('word/document.xml')!.async('string')
  const document = new DOMParser().parseFromString(mainXml, 'application/xml')
  const relationships = new DOMParser().parseFromString(await zip.file('word/_rels/document.xml.rels')?.async('string') ?? '<Relationships/>', 'application/xml')
  const main = sanitize((await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer })).value)
  const part = async (kind: 'header' | 'footer') => {
    const reference = document.getElementsByTagNameNS('*', kind + 'Reference')[0]
    const id = reference?.getAttribute('r:id')
    const relationship = [...relationships.getElementsByTagNameNS('*', 'Relationship')].find(item => item.getAttribute('Id') === id)
    const target = relationship?.getAttribute('Target') ?? ''
    if (!/^(?:header|footer)[\w.-]*\.xml$/.test(target)) return ''
    const xml = await zip.file('word/' + target)?.async('string')
    if (!xml) return ''
    const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement
    const attrs = [...root.attributes].map(attr => `${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`).join(' ')
    zip.file('word/document.xml', `<w:document ${attrs}><w:body>${root.innerHTML}</w:body></w:document>`)
    zip.file('word/_rels/document.xml.rels', await zip.file('word/_rels/' + target + '.rels')?.async('string') ?? '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
    return sanitize((await mammoth.convertToHtml({ arrayBuffer: await zip.generateAsync({ type: 'arraybuffer' }) })).value)
  }
  const header = await part('header'), footer = await part('footer')
  const margin = document.getElementsByTagNameNS('*', 'pgMar')[0]
  const margins = ['top', 'right', 'bottom', 'left'].map(key => {
    const value = Number(margin?.getAttribute('w:' + key)) / 15
    return Number.isFinite(value) && value > 0 && value < 500 ? value : 72
  }) as [number, number, number, number]
  return { html: { main, header, footer }, margins }
}
