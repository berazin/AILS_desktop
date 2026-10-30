// Registers all UI translation dictionaries. Import once for side effects.
import { registerDictionary } from "./i18n.ts"
import { dictCore } from "./i18n-dict-core.ts"
import { dictPdf } from "./i18n-dict-pdf.ts"
import { dictStudy } from "./i18n-dict-study.ts"

registerDictionary(dictCore)
registerDictionary(dictPdf)
registerDictionary(dictStudy)
