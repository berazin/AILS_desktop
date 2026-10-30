import DOMPurify from 'dompurify'

export type ResourceLoader = (path: string) => Promise<{ data: string; mime: string }>
function localPath(value: string) {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/|\\|#)/i.test(value)) return null
  try { return decodeURIComponent(value.split(/[?#]/)[0]) } catch { return null }
}
export async function htmlPreview(source: string, resource: ResourceLoader): Promise<string> {
  const clean = DOMPurify.sanitize(source, { WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'form', 'input', 'button', 'meta'],
    FORBID_ATTR: ['srcset', 'action', 'formaction'] })
  const doc = new DOMParser().parseFromString(clean, 'text/html')
  const load = async (value: string) => {
    const path = localPath(value)
    if (!path) return ''
    try { const asset = await resource(path); return `data:${asset.mime};base64,${asset.data}` } catch { return '' }
  }
  const css = (value: string) => value.replace(/@import\s[^;]+;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'url("")')
  await Promise.all([...doc.querySelectorAll('img')].map(async img => {
    const value = img.getAttribute('src') ?? ''
    img.setAttribute('src', /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value) ? value : await load(value))
  }))
  await Promise.all([...doc.querySelectorAll('link')].map(async link => {
    const path = localPath(link.getAttribute('href') ?? '')
    if (link.rel === 'stylesheet' && path) {
      try { const asset = await resource(path); const style = doc.createElement('style'); style.textContent = css(new TextDecoder().decode(Uint8Array.from(atob(asset.data), c => c.charCodeAt(0)))); link.replaceWith(style); return } catch { /* Missing resources remain absent. */ }
    }
    link.remove()
  }))
  doc.querySelectorAll('style').forEach(style => { style.textContent = css(style.textContent ?? '') })
  doc.querySelectorAll('[style]').forEach(node => node.setAttribute('style', css(node.getAttribute('style') ?? '')))
  doc.querySelectorAll('a').forEach(a => { a.removeAttribute('href'); a.removeAttribute('target') })
  const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  doc.head.prepend(policy)
  return '<!doctype html>' + doc.documentElement.outerHTML
}
