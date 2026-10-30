import type { OfficeMount } from './types.ts'

/** Loading editor code creates no document, session, worker or editable state. */
export async function loadOfficeEngine(kind: string): Promise<OfficeMount> {
  switch (kind) {
    case 'xlsx': {
      // The parser is independent of Univer. Fetch/evaluate both while the
      // backend reads the file, instead of waiting for the grid to call readXlsx.
      const [engine] = await Promise.all([import('./sheets-engine.ts'), import('exceljs')])
      return engine.mountSheets
    }
    case 'csv': return (await import('./sheets-engine.ts')).mountSheets
    case 'docx': return (await import('./canvas-engine.ts')).mountCanvas
    case 'hwp': case 'hwpx': return (await import('./rhwp-engine.ts')).mountRhwp
    case 'html': case 'htm': return (await import('./html-engine.ts')).mountHtml
    default: throw new Error(`Unsupported office format: ${kind}`)
  }
}
