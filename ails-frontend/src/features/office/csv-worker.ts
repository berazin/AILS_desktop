import { readCsv } from './csv-adapter.ts'
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const value = readCsv(new Uint8Array(event.data))
    if (value.rows.reduce((n, row) => n + row.length, 0) > 2000000) throw new Error('CSV 편집은 200만 셀까지 지원합니다.')
    self.postMessage({ value })
  } catch (error) { self.postMessage({ error: String(error) }) }
}
