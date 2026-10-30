import { readCsv } from './csv-adapter.ts'
export async function loadCsv(bytes: Uint8Array): Promise<ReturnType<typeof readCsv>> {
  if (bytes.length < 256000) return readCsv(bytes)
  const worker = new Worker(new URL('./csv-worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('CSV 분석 시간이 초과되었습니다. 파일을 나눠 주세요.')) }, 30000)
      worker.onmessage = event => { clearTimeout(timer); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.value) }
      worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message || 'CSV 분석에 실패했습니다.')) }
      const buffer = bytes.slice().buffer
      worker.postMessage(buffer, [buffer])
    })
  } finally { worker.terminate() }
}
