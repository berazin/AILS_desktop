const scripts = new Map()
function script(src) {
  if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
    const element = document.createElement('script'); element.src = src
    element.onload = resolve; element.onerror = () => { scripts.delete(src); reject(new Error('뷰어 모듈을 읽지 못했습니다.')) }
    document.head.append(element)
  }))
  return scripts.get(src)
}
const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element }
async function html(target, source) {
  const { default: purify } = await import('/vendor/purify.js')
  target.innerHTML = purify.sanitize(source, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'], FORBID_ATTR: ['style', 'srcset'] })
  // Documents cannot initiate external requests or load local filesystem paths.
  for (const image of target.querySelectorAll('img')) if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(image.getAttribute('src') || '')) image.removeAttribute('src')
}
async function markdown(target, source) {
  const { marked } = await import('/vendor/marked.js')
  await html(target, marked.parse(source, { async: false }))
}
function table(target, rows) {
  const element = document.createElement('table'), body = document.createElement('tbody')
  for (const row of rows.slice(0, 2000)) {
    const tr = document.createElement('tr')
    for (const value of row.slice(0, 100)) tr.append(node('td', String(value ?? '')))
    body.append(tr)
  }
  element.append(body); target.append(element)
  if (rows.length > 2000) target.append(node('p', '첫 2,000행을 표시했습니다. 전체 편집은 AILS 작업공간에서 사용할 수 있습니다.'))
}
export async function renderDocument(doc, host, current) {
  if (doc.size > 128 * 1024 * 1024) throw new Error('128MB를 넘는 문서는 작업공간에서 열어 주세요')
  const article = document.createElement('article'); article.className = 'document'
  const kind = doc.kind
  if (['ppt', 'pptx', 'hwp', 'hwpx', 'epub', 'mobi', 'azw', 'azw3', 'fb2', 'rtf'].includes(kind)) {
    const result = await window.ailsDesktop.api.convert_viewer_document(doc.token)
    article.append(node('div', '읽기용 본문 · 원본 레이아웃과 편집 기능은 AILS 작업공간에서 사용할 수 있습니다.'))
    article.firstChild.className = 'reading-note'
    const body = document.createElement('div'); await markdown(body, result.content); article.append(body)
  } else {
    const response = await fetch(doc.url)
    if (!response.ok) throw new Error(`파일을 읽지 못했습니다 (${response.status})`)
    if (kind === 'docx') {
      await script('/vendor/mammoth.js')
      const result = await window.mammoth.convertToHtml({ arrayBuffer: await response.arrayBuffer() })
      await html(article, result.value)
    } else if (kind === 'xlsx') {
      await script('/vendor/exceljs.js')
      const workbook = new window.ExcelJS.Workbook()
      await workbook.xlsx.load(await response.arrayBuffer())
      const picker = document.createElement('select'); picker.className = 'sheet-picker'; picker.setAttribute('aria-label', '시트')
      const grid = document.createElement('div')
      for (const sheet of workbook.worksheets) { const option = node('option', sheet.name); option.value = sheet.id; picker.append(option) }
      const display = () => {
        const sheet = workbook.getWorksheet(Number(picker.value)); grid.replaceChildren()
        const rows = []
        for (let r = 1; r <= Math.min(sheet?.rowCount || 0, 2001); r++) {
          const row = sheet.getRow(r); rows.push(Array.from({ length: Math.min(sheet.columnCount, 100) }, (_, c) => row.getCell(c + 1).text))
        }
        table(grid, rows)
      }
      picker.onchange = display; article.append(picker, grid); display()
    } else {
      const source = await response.text()
      if (kind === 'md') await markdown(article, source)
      else if (kind === 'html' || kind === 'htm') await html(article, source)
      else if (kind === 'csv') { await script('/vendor/papaparse.js'); table(article, window.Papa.parse(source, { skipEmptyLines: true }).data) }
      else if (kind === 'ipynb') {
        const notebook = JSON.parse(source)
        for (const cell of notebook.cells || []) {
          const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '')
          if (cell.cell_type === 'markdown') { const section = document.createElement('section'); await markdown(section, source); article.append(section) }
          else {
            article.append(node('pre', source))
            for (const output of cell.outputs || []) {
              const text = output.text || output.data?.['text/plain']
              if (text) article.append(node('pre', Array.isArray(text) ? text.join('') : text))
            }
          }
        }
      } else article.append(node('pre', source))
    }
  }
  if (current()) host.replaceChildren(article)
}
