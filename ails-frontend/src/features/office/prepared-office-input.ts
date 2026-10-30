import type { OfficeFile } from '../../lib/api/office.ts'
import { markDocumentStartupPhase } from '../../lib/document-presentation-diagnostics.ts'
import { decodeBytes } from './types.ts'
import type { readXlsx } from './xlsx-adapter.ts'

type OfficeInput = { bytes: Uint8Array; xlsx?: ReturnType<typeof readXlsx> }
// The one-use API response owns its decoded/parsed input. Neither the path nor
// its contents are retained after that response is consumed or expires.
const inputs = new WeakMap<OfficeFile, OfficeInput>()

export function prepareOfficeInput(file: OfficeFile, kind: string) {
  if (inputs.has(file)) return
  const input: OfficeInput = { bytes: decodeBytes(file.data) }
  inputs.set(file, input)
  if (kind === 'xlsx') {
    input.xlsx = import('./xlsx-adapter.ts').then(async ({ readXlsx }) => {
      markDocumentStartupPhase('xlsx-parse-start')
      const parsed = await readXlsx(input.bytes, file.path)
      markDocumentStartupPhase('xlsx-parse-ready')
      return parsed
    })
    // The editor awaits this same result, including its failure. Preparing an
    // unused document must not produce an unhandled rejection.
    void input.xlsx.catch(() => {})
  }
}

export function takeOfficeInput(file: OfficeFile): OfficeInput {
  const input = inputs.get(file)
  inputs.delete(file)
  return input ?? { bytes: decodeBytes(file.data) }
}
