import Papa from 'papaparse'
import iconv from 'iconv-lite'
import { Buffer } from 'buffer'

export type CsvOptions = { encoding: string; delimiter: string; newline: string; bom: boolean; trailingNewline: boolean }
// Signed decimal/scientific literals cannot invoke spreadsheet functions.
// Protect executable expressions without changing legitimate negative data.
export const CSV_FORMULA_PREFIX = /^\s*(?:[=@]|[+-](?!(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$))/
export function readCsv(bytes: Uint8Array, encoding?: string, delimiter?: string) {
  const bom = bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191
  let detected = encoding ?? 'utf8'
  if (!encoding) { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { detected = 'cp949' } }
  const text = iconv.decode(Buffer.from(bytes), detected).replace(/^\uFEFF/, '')
  const parsed = Papa.parse<string[]>(text, { delimiter, dynamicTyping: false, skipEmptyLines: false })
  if (parsed.errors.some(e => e.code !== 'UndetectableDelimiter')) throw new Error(`CSV 구문 오류: ${parsed.errors[0].message}`)
  const trailingNewline = /\r?\n$/.test(text)
  if (trailingNewline && parsed.data.at(-1)?.length === 1 && parsed.data.at(-1)?.[0] === '') parsed.data.pop()
  return { rows: parsed.data, options: { encoding: detected, delimiter: parsed.meta.delimiter || ',',
    newline: parsed.meta.linebreak || '\r\n', bom, trailingNewline } satisfies CsvOptions }
}
export function writeCsv(rows: string[][], options: CsvOptions, escapeFormulae = false) {
  const text = Papa.unparse(rows, { delimiter: options.delimiter, newline: options.newline, escapeFormulae: escapeFormulae ? CSV_FORMULA_PREFIX : false })
    + (options.trailingNewline ? options.newline : '')
  const encoded = iconv.encode(text, options.encoding)
  if (iconv.decode(encoded, options.encoding) !== text) throw new Error('선택한 인코딩으로 저장할 수 없는 문자가 있습니다. UTF-8로 변경하세요.')
  return new Uint8Array(options.bom && /utf-?8/i.test(options.encoding) ? Buffer.concat([Buffer.from([239, 187, 191]), encoded]) : encoded)
}
export function hasCsvFormula(rows: string[][]) { return rows.some(row => row.some(value => CSV_FORMULA_PREFIX.test(value))) }
