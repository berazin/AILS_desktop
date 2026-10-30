import type ExcelJS from 'exceljs'
import { CellValueType, DateSystem, LocaleType, type IWorkbookData, type ICellData, type IStyleData } from '@univerjs/core'

export function emptyWorkbook(name: string): IWorkbookData {
  return { id: crypto.randomUUID(), name, appVersion: '1.1.0', locale: LocaleType.EN_US, styles: {}, sheetOrder: [], sheets: {} }
}
function toStyle(cell: ExcelJS.Cell): IStyleData {
  const { font, fill, alignment, numFmt } = cell
  const bd: NonNullable<IStyleData['bd']> = {}
  for (const [key, side] of BORDER_SIDES) {
    const border = cell.border?.[side]
    if (border?.style) bd[key] = { s: BORDER_STYLES.indexOf(border.style), cl: { rgb: '#' + (border.color?.argb?.slice(-6) ?? '000000') } }
  }
  return { ff: font?.name, fs: font?.size, bl: font?.bold ? 1 : 0, it: font?.italic ? 1 : 0, bd,
    ul: { s: font?.underline ? 1 : 0 }, st: { s: font?.strike ? 1 : 0 },
    cl: font?.color?.argb ? { rgb: `#${font.color.argb.slice(-6)}` } : undefined,
    bg: fill?.type === 'pattern' && fill.fgColor?.argb ? { rgb: `#${fill.fgColor.argb.slice(-6)}` } : undefined,
    ht: ({ left: 1, center: 2, right: 3 } as Record<string, number>)[alignment?.horizontal ?? ''],
    vt: ({ top: 1, middle: 2, bottom: 3 } as Record<string, number>)[alignment?.vertical ?? ''],
    tb: alignment?.wrapText ? 3 : 1, n: numFmt ? { pattern: numFmt } : undefined }
}
const BORDER_SIDES = [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']] as const
const BORDER_STYLES = [undefined, 'thin', 'hair', 'dotted', 'dashed', 'dashDot', 'dashDotDot', 'double', 'medium', 'mediumDashed', 'mediumDashDot', 'mediumDashDotDot', 'slantDashDot', 'thick'] as const
function serial(date: Date, date1904: boolean) { return date.getTime() / 86400000 + (date1904 ? 24107 : 25569) }
export async function readXlsx(bytes: Uint8Array, name: string) {
  const { default: ExcelJS } = await import('exceljs')
  const original = new ExcelJS.Workbook()
  await original.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const snapshot = emptyWorkbook(name)
  const date1904 = Boolean(original.properties.date1904)
  snapshot.dateSystem = date1904 ? DateSystem.Date1904 : DateSystem.Date1900
  const warnings: string[] = []
  let total = 0
  original.eachSheet((sheet) => {
    if (sheet.rowCount * Math.max(1, sheet.columnCount) > 2000000) throw new Error('시트가 너무 큽니다. 200만 셀 이내로 나눠 주세요.')
    const id = String(sheet.id)
    snapshot.sheetOrder.push(id)
    const cellData: Record<number, Record<number, ICellData>> = {}
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: Record<number, ICellData> = {}
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (++total > 500000) throw new Error('편집 가능한 셀 수 50만 개를 초과했습니다.')
        if (cell.isMerged && cell.master !== cell) return
        const value = cell.value
        let v: string | number | boolean | null
        let f: string | undefined
        if (value instanceof Date) v = serial(value, date1904)
        else if (value != null && typeof value === 'object') {
          if ('formula' in value || 'sharedFormula' in value) {
            f = '=' + cell.formula
            const result = cell.result
            v = result instanceof Date ? serial(result, date1904) : typeof result === 'object' ? null : result ?? null
          } else { v = cell.text; warnings.push('리치 텍스트·하이퍼링크 등 일부 셀 속성은 값 편집 시 단순화됩니다.') }
        } else v = value ?? null
        cells[columnNumber - 1] = { v, f, t: typeof v === 'number' ? CellValueType.NUMBER : typeof v === 'boolean' ? CellValueType.BOOLEAN : CellValueType.STRING, s: toStyle(cell) }
      })
      cellData[rowNumber - 1] = cells
    })
    const rowData: Record<number, { h?: number; hd?: 0 | 1 }> = {}
    sheet.eachRow({ includeEmpty: true }, (row, n) => { if (row.height || row.hidden) rowData[n - 1] = { h: row.height ? row.height * 4 / 3 : undefined, hd: row.hidden ? 1 : 0 } })
    const columnData = Object.fromEntries(sheet.columns.map((col, i) => [i, { w: col.width ? col.width * 7 + 5 : 80, hd: col.hidden ? 1 : 0 }]))
    snapshot.sheets[id] = { id, name: sheet.name, rowCount: Math.max(sheet.rowCount + 50, 100), columnCount: Math.max(sheet.columnCount + 5, 20),
      cellData, rowData, columnData, hidden: sheet.state === 'veryHidden' ? 2 : sheet.state === 'hidden' ? 1 : 0,
      mergeData: (sheet.model.merges ?? []).map(range => { const [a, b] = range.split(':').map(address => sheet.getCell(address)); return { startRow: Number(a.row) - 1, endRow: Number(b.row) - 1, startColumn: Number(a.col) - 1, endColumn: Number(b.col) - 1 } }),
      defaultColumnWidth: 80, defaultRowHeight: 24 }
  })
  return { snapshot, original, baseline: structuredClone(snapshot), warnings: [...new Set(warnings)] }
}
export async function writeXlsx(snapshot: IWorkbookData, original: ExcelJS.Workbook, baseline: IWorkbookData) {
  const { default: ExcelJS } = await import('exceljs')
  // Retain ExcelJS's original workbook model (print settings, images, metadata).
  const workbook = new ExcelJS.Workbook()
  const orderedIds: number[] = []
  workbook.model = structuredClone(original.model)
  for (const sheet of [...workbook.worksheets]) if (!snapshot.sheetOrder.includes(String(sheet.id))) workbook.removeWorksheet(sheet.id)
  for (const [position, id] of snapshot.sheetOrder.entries()) {
    const data = snapshot.sheets[id]
    const sheet = workbook.getWorksheet(Number(id)) ?? workbook.addWorksheet(data.name ?? `Sheet${position + 1}`)
    orderedIds.push(sheet.id)
    sheet.name = data.name ?? sheet.name
    sheet.state = data.hidden === 2 ? 'veryHidden' : data.hidden ? 'hidden' : 'visible'
    const oldCells = baseline.sheets[id]?.cellData ?? {}
    const cells = data.cellData ?? {}
    for (const range of [...(sheet.model.merges ?? [])]) sheet.unMergeCells(range)
    const rowIds = new Set([...Object.keys(oldCells), ...Object.keys(cells)])
    for (const row of rowIds) {
      for (const col of new Set([...Object.keys(oldCells[+row] ?? {}), ...Object.keys(cells[+row] ?? {})])) {
        const value = cells[+row]?.[+col]
        const previous = oldCells[+row]?.[+col]
        const cell = sheet.getCell(+row + 1, +col + 1)
        if (!value) { cell.value = null; cell.style = {}; continue }
        if (JSON.stringify(value) === JSON.stringify(previous)) continue
        if (value.f) cell.value = { formula: value.f.replace(/^=/, ''), result: typeof value.v === 'number' || typeof value.v === 'string' || typeof value.v === 'boolean' ? value.v : undefined }
        else cell.value = value.p?.body?.dataStream?.replace(/\r\n$/, '') ?? value.v ?? null
        const style = typeof value.s === 'string' ? snapshot.styles[value.s] : value.s
        if (style) {
          cell.font = { ...cell.font, name: style.ff ?? undefined, size: style.fs, bold: !!style.bl, italic: !!style.it, underline: !!style.ul?.s, strike: !!style.st?.s,
            ...(style.cl?.rgb ? { color: { argb: 'FF' + style.cl.rgb.replace('#', '') } } : {}) }
          cell.numFmt = style.n?.pattern ?? 'General'
          if (style.bg?.rgb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + style.bg.rgb.replace('#', '') } }
          else cell.fill = { type: 'pattern', pattern: 'none' }
          if (style.bd) for (const [key, side] of BORDER_SIDES) {
            const border = style.bd[key]
            cell.border = { ...cell.border, [side]: border?.s ? { style: BORDER_STYLES[border.s], color: { argb: 'FF' + (border.cl.rgb?.replace('#', '') ?? '000000') } } : undefined }
          }
          cell.alignment = { ...cell.alignment, horizontal: ({ 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'fill', 6: 'distributed' } as const)[style.ht as 1 | 2 | 3 | 4 | 5 | 6],
            vertical: (['', 'top', 'middle', 'bottom'] as const)[style.vt ?? 0] || undefined, wrapText: style.tb === 3 }
        }
      }
    }
    for (const [row, settings] of Object.entries(data.rowData ?? {})) { if (settings.h != null) sheet.getRow(+row + 1).height = settings.h * 3 / 4; sheet.getRow(+row + 1).hidden = !!settings.hd }
    for (const [col, settings] of Object.entries(data.columnData ?? {})) { if (settings.w != null) sheet.getColumn(+col + 1).width = Math.max(0, (settings.w - 5) / 7); sheet.getColumn(+col + 1).hidden = !!settings.hd }
    for (const merge of data.mergeData ?? []) sheet.mergeCells(merge.startRow + 1, merge.startColumn + 1, merge.endRow + 1, merge.endColumn + 1)
  }
  const model = workbook.model
  model.sheets.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id))
  workbook.model = model
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
