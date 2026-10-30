import { getDocument, GlobalWorkerOptions, TextLayer } from '/vendor/pdf.mjs'
GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs'
const $ = id => document.getElementById(id)

export async function openPdf(doc, host, current, status) {
  const task = getDocument({ url: doc.url, cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/', isEvalSupported: false })
  let pdf, rendering, textLayer, resizeObserver, resizeTimer, serial = 0, disposed = false
  const clean = () => { disposed = true; serial++; clearTimeout(resizeTimer); resizeObserver?.disconnect(); host.onkeydown = null; rendering?.cancel(); textLayer?.cancel(); void task.destroy() }
  try {
    pdf = await task.promise
    if (!current()) { clean(); return () => {} }
    $('page-count').textContent = `/ ${pdf.numPages}`; $('page').max = pdf.numPages
    async function render() {
      const version = ++serial
      rendering?.cancel(); textLayer?.cancel()
      doc.page = Math.max(1, Math.min(pdf.numPages, Math.round(Number(doc.page) || 1)))
      $('page').value = doc.page
      $('page-label').textContent = `${doc.page} / ${pdf.numPages}`
      $('zoom-label').textContent = `${Math.round(doc.zoom * 100)}%`
      $('previous').disabled = doc.page === 1; $('next').disabled = doc.page === pdf.numPages
      const page = await pdf.getPage(doc.page)
      if (disposed || !current() || serial !== version) return
      const base = page.getViewport({ scale: 1 })
      const scale = Math.max(.01, Math.min(host.clientWidth / base.width, host.clientHeight / base.height)) * doc.zoom
      const viewport = page.getViewport({ scale }), ratio = Math.min(2, devicePixelRatio || 1)
      const sheet = document.createElement('div'); sheet.className = 'pdf-page'
      sheet.style.width = `${viewport.width}px`; sheet.style.height = `${viewport.height}px`
      sheet.style.setProperty('--total-scale-factor', String(scale))
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
      const layer = document.createElement('div'); layer.className = 'textLayer'
      sheet.append(canvas, layer)
      host.replaceChildren(sheet)
      rendering = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport })
      await Promise.all([rendering.promise, textLayer.render()])
      if (disposed || !current() || serial !== version) return
      host.scrollTop = 0; status()
    }
    const rerender = () => { void render().catch(error => { if (error.name !== 'RenderingCancelledException' && !disposed && current()) status(error.message) }) }
    $('previous').onclick = () => { doc.page--; rerender() }
    $('next').onclick = () => { doc.page++; rerender() }
    const submitPage = () => { doc.page = Number($('page').value); $('page').hidden = true; $('page-label').hidden = false; rerender() }
    $('page').hidden = true; $('page-label').hidden = false
    $('page-label').onclick = () => { $('page-label').hidden = true; $('page').hidden = false; $('page').focus(); $('page').select() }
    $('page').onblur = submitPage
    $('page').onkeydown = event => {
      if (event.key === 'Enter') $('page').blur()
      if (event.key === 'Escape') { $('page').value = doc.page; $('page').blur() }
    }
    $('zoom-in').onclick = () => { doc.zoom = Math.min(3, Math.round((doc.zoom + .05) * 100) / 100); rerender() }
    $('zoom-out').onclick = () => { doc.zoom = Math.max(.75, Math.round((doc.zoom - .05) * 100) / 100); rerender() }
    host.onkeydown = event => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault(); doc.page += ['ArrowRight', 'PageDown'].includes(event.key) ? 1 : -1; rerender()
      }
    }
    await render()
    let size = `${host.clientWidth}:${host.clientHeight}`
    resizeObserver = new ResizeObserver(() => {
      const next = `${host.clientWidth}:${host.clientHeight}`
      if (size === next) return
      size = next; clearTimeout(resizeTimer); resizeTimer = setTimeout(rerender, 75)
    })
    resizeObserver.observe(host)
    return clean
  } catch (error) { clean(); throw error }
}
