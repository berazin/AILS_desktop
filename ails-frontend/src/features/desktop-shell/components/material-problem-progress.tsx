import { t } from "../../../lib/i18n.ts"

export function MaterialProblemProgress({ solved, total }: { solved?: number; total?: number }) {
  if (!Number.isInteger(total) || !total || total < 0 || !Number.isInteger(solved) || solved === undefined || solved < 0 || solved > total) return null
  return <span data-ails-material-problem-progress className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-slate-500 dark:bg-white/[0.06] dark:text-white/60"
    title={t("문제 풀이")} aria-label={`${t("문제 풀이")} ${solved}/${total}`}>{solved}/{total}</span>
}
