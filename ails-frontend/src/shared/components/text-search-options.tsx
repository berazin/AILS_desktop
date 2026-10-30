import { Regex, WholeWord } from "lucide-react"
import type { Dispatch, SetStateAction } from "react"
import { t } from "../../lib/i18n.ts"
import type { TextSearchOptions as Options } from "../lib/text-search.ts"

export function TextSearchOptions({ value, onChange }: { value: Options; onChange: Dispatch<SetStateAction<Options>> }) {
  return <div className="flex shrink-0 items-center gap-1">
    {([{ key: "wholeWord", label: "단어 검색", Icon: WholeWord }, { key: "regex", label: "정규식 검색", Icon: Regex }] as const).map(({ key, label, Icon }) =>
      <button key={key} type="button" aria-label={t(label)} title={t(label)} aria-pressed={value[key]}
        className={`rounded p-1.5 ${value[key] ? "bg-[var(--brand-soft)] text-[var(--brand)] ring-1 ring-[var(--brand)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}
        onClick={() => onChange(current => ({ ...current, [key]: !current[key] }))}><Icon size={16} /></button>)}
  </div>
}
