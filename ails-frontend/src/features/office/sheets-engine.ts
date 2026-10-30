import { createUniver, LocaleType } from '@univerjs/presets'
import { sheetsCorePreset } from './sheets-ui-controller.ts'
import coreEn from '@univerjs/preset-sheets-core/locales/ko-KR'
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter'
import filterEn from '@univerjs/preset-sheets-filter/locales/ko-KR'
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort'
import sortEn from '@univerjs/preset-sheets-sort/locales/ko-KR'
import { SheetsFindReplaceController, UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace'
import findEn from '@univerjs/preset-sheets-find-replace/locales/ko-KR'
import { CellValueType, IUniverInstanceService, mergeLocales, type IWorkbookData, type ICellData } from '@univerjs/core'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import '@univerjs/preset-sheets-sort/lib/index.css'
import '@univerjs/preset-sheets-find-replace/lib/index.css'
import { emptyWorkbook, readXlsx, writeXlsx } from './xlsx-adapter.ts'
import { hasCsvFormula, writeCsv, type CsvOptions } from './csv-adapter.ts'
import { loadCsv } from './csv-loader.ts'
import { registerSheetsSaveShortcuts } from './sheets-save-shortcuts.ts'
import type { OfficeMount } from './types.ts'
import { markDocumentStartupPhase } from '../../lib/document-presentation-diagnostics.ts'

export function workbookRows(snapshot: IWorkbookData) {
  const cells = snapshot.sheets[snapshot.sheetOrder[0]]?.cellData ?? {}
  const lastRow = Object.keys(cells).reduce((max, key) => Math.max(max, +key), -1)
  const lastCol = Object.values(cells).reduce((max, row) => Object.keys(row).reduce((n, key) => Math.max(n, +key), max), -1)
  if ((lastRow + 1) * (lastCol + 1) > 2000000) throw new Error('CSV 저장 범위가 너무 큽니다.')
  return Array.from({ length: lastRow + 1 }, (_, row) => Array.from({ length: lastCol + 1 }, (_, col) => {
    const cell = cells[row]?.[col]
    // CSV has no formula type. Keep the exact formula source as text.
    return String(cell?.f ?? cell?.p?.body?.dataStream?.replace(/\r\n$/, '') ?? cell?.v ?? '')
  }))
}
export const mountSheets: OfficeMount = async (container, bytes, name, changed, options) => {
  markDocumentStartupPhase('sheets-parse-start')
  const csv = /\.csv$/i.test(name)
  const xlsx = csv ? null : await (options.xlsx ?? readXlsx(bytes, name))
  const parsed = csv ? await loadCsv(bytes) : null
  markDocumentStartupPhase('sheets-parse-ready')
  let csvOptions: CsvOptions | undefined = parsed?.options
  let escapeFormulae = true
  const snapshot = xlsx?.snapshot ?? emptyWorkbook(name)
  const controls = document.createElement('div')
  controls.className = 'office-format-options'
  if (parsed) {
    if (parsed.rows.reduce((n, r) => n + r.length, 0) > 2000000) throw new Error('CSV 편집은 200만 셀까지 지원합니다.')
    const id = 'csv'
    const cellData: Record<number, Record<number, ICellData>> = {}
    for (const [r, row] of parsed.rows.entries()) {
      cellData[r] = {}; row.forEach((v, c) => { cellData[r][c] = { v, t: CellValueType.STRING } })
      if (r % 2000 === 1999) await new Promise(resolve => setTimeout(resolve, 0))
    }
    snapshot.sheetOrder = [id]
    snapshot.sheets[id] = { id, name: 'CSV', cellData, rowCount: Math.max(100, parsed.rows.length + 20), columnCount: parsed.rows.reduce((n, row) => Math.max(n, row.length), 20), defaultColumnWidth: 100, defaultRowHeight: 24 }
    const label = document.createElement('span'); label.textContent = 'CSV: 현재 시트의 값만 저장 · 인코딩 '
    const encoding = document.createElement('select'); encoding.setAttribute('aria-label', 'CSV 저장 인코딩')
    for (const value of ['utf8', 'cp949']) { const option = document.createElement('option'); option.value = value; option.textContent = value.toUpperCase(); encoding.append(option) }
    encoding.value = csvOptions!.encoding
    encoding.onchange = () => { csvOptions = { ...csvOptions!, encoding: encoding.value, bom: false }; changed() }
    const delimiter = document.createElement('select'); delimiter.setAttribute('aria-label', 'CSV 저장 구분자')
    for (const [value, text] of [[',', '쉼표'], ['\t', '탭'], [';', '세미콜론']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; delimiter.append(option) }
    delimiter.value = csvOptions!.delimiter
    delimiter.onchange = () => { csvOptions = { ...csvOptions!, delimiter: delimiter.value }; changed() }
    controls.append(label, encoding, delimiter)
    const protection = document.createElement('label'), checkbox = document.createElement('input')
    checkbox.type = 'checkbox'; checkbox.checked = true
    checkbox.onchange = () => { escapeFormulae = checkbox.checked; changed() }
    protection.append(checkbox, 'Excel 수식 실행 방지 (위험 접두사에 작은따옴표 추가)')
    controls.append(protection)
    if (hasCsvFormula(parsed.rows)) { const warning = document.createElement('span'); warning.textContent = '수식으로 해석될 수 있는 원본 값이 있습니다. 보호 옵션은 저장값에 작은따옴표를 추가합니다.'; controls.append(warning) }
  }
  if (xlsx?.warnings.length) controls.textContent = xlsx.warnings.join(' ')
  const host = document.createElement('div'); host.style.cssText = 'flex:1;min-height:0;position:relative'
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0'
  container.append(controls, host)
  markDocumentStartupPhase('sheets-plugins-start')
  const { univer, univerAPI } = createUniver({ locale: LocaleType.KO_KR, darkMode: options.dark,
    locales: { [LocaleType.KO_KR]: mergeLocales(coreEn, filterEn, sortEn, findEn) },
    presets: [sheetsCorePreset(host), UniverSheetsFilterPreset(), UniverSheetsSortPreset(), UniverSheetsFindReplacePreset()] })
  markDocumentStartupPhase('sheets-plugins-ready')
  const workbook = univerAPI.createWorkbook(snapshot)
  const saveShortcuts = registerSheetsSaveShortcuts(univer.__getInjector(), container)
  markDocumentStartupPhase('sheets-workbook-ready')
  const subscription = workbook.onCommandExecuted(command => { if (command.type === 2) changed() })
  const active = () => workbook.getActiveSheet()?.getActiveRange()
  const synchronize = async () => {
    await univerAPI.executeCommand('sheet.operation.set-cell-edit-visible', { visible: false })
    if (!csv) await univerAPI.getFormula().onCalculationResultApplied(15000)
  }
  return {
    presentationElement: () => host.querySelector('[data-ails-sheets-presented] canvas[data-ails-sheets-canvas]'),
    // Close checks must commit an in-cell edit before deciding whether dirty is
    // false; serialization alone runs too late for a previously clean workbook.
    synchronize,
    serialize: async () => {
      // Commit an active in-cell edit before reading the snapshot.
      await synchronize()
      const data = workbook.save()
      if (!csv) return writeXlsx(data, xlsx!.original, xlsx!.baseline)
      if (data.sheetOrder.length !== 1) throw new Error('CSV에는 한 시트만 저장할 수 있습니다. 추가 시트를 삭제하거나 XLSX 문서에서 작업하세요.')
      return writeCsv(workbookRows(data), csvOptions!, escapeFormulae)
    },
    text: async () => { const data = workbook.save(); return data.sheetOrder.map(id => `${data.sheets[id]?.name}\n${workbookRows({ ...data, sheetOrder: [id] }).map(r => r.join('\t')).join('\n')}`).join('\n') },
    selection: async () => ({ text: active()?.getValues().map(r => r.map(v => v ?? '').join('\t')).join('\n') ?? '', target: `${workbook.getActiveSheet()?.getSheetId()}:${active()?.getA1Notation()}` }),
    replaceSelection: async text => {
      const range = active(); if (!range) throw new Error('셀을 선택하세요.')
      const rows = text.split('\n').map(r => r.split('\t'))
      const bounds = range.getRange()
      const width = rows.reduce((n, row) => Math.max(n, row.length), 0)
      if (rows.length > bounds.endRow - bounds.startRow + 1 || width > bounds.endColumn - bounds.startColumn + 1) throw new Error('수정안이 선택 범위를 벗어납니다. 적용할 셀 범위를 먼저 선택하세요.')
      const target = workbook.getActiveSheet().getRange(bounds.startRow, bounds.startColumn, rows.length, width)
      target.setValues(rows.map(row => Array.from({ length: width }, (_, col) => {
        const value = row[col] ?? ''
        return !csv && value.startsWith('=') ? { f: value } : { v: value, t: CellValueType.STRING }
      })))
    },
    command: async command => {
      // AILS toolbar buttons sit outside Univer's focus scope. Bind commands
      // to this workbook before opening search or applying undo/redo.
      const injector = univer.__getInjector()
      // Univer normally registers the sheet search provider at Steady (3s).
      // A first-use command must work immediately after the document appears.
      if (command === 'find') injector.get(SheetsFindReplaceController)
      injector.get(IUniverInstanceService).focusUnit(workbook.getId())
      await univerAPI.executeCommand(command === 'undo' ? 'univer.command.undo' : command === 'redo' ? 'univer.command.redo' : 'ui.operation.open-find-dialog')
    },
    destroy: () => { saveShortcuts.dispose(); subscription.dispose(); queueMicrotask(() => univer.dispose()); container.replaceChildren() },
  }
}
