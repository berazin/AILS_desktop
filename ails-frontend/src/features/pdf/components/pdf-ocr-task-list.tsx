import { Loader2 } from "lucide-react"
import type { PdfController } from "../hooks/use-pdf-controller.ts"
import type { PdfWorkspaceDomain } from "../hooks/use-pdf-workspace-domain.ts"
import { PDF_OCR_MODEL_LABELS, pdfOcrProviderLabel } from "../../../lib/pdf-ocr-display.ts"
import { t } from "../../../lib/i18n.ts"

export function PdfOcrTaskList({ ocr, actions }: {
  ocr: PdfController["ocr"]
  actions: Pick<PdfWorkspaceDomain["workflows"]["ocr"], "stopPdfOcrJob" | "stopFullPdfOcr" | "stopBenchmarkPdfOcr">
}) {
  if (!ocr.pdfOcrJobs.length && !ocr.pdfFullOcrProgress && !ocr.pdfOcrBenchmarkProgress) return null
  const fullProgress = ocr.pdfFullOcrProgress
  const benchmark = ocr.pdfOcrBenchmarkProgress
  return <section className="max-h-60 shrink-0 overflow-y-auto border-b border-[var(--border)] px-5 py-3" aria-label={t("실행 중인 OCR")} data-ails-ocr-task-list="true">
    <h3 className="mb-2 text-xs font-semibold">{t("실행 중인 OCR")}</h3>
    {ocr.pdfOcrJobs.map((job) => <div className="mb-2 flex items-start gap-2 rounded-lg bg-[var(--muted)] p-2 text-xs" key={job.jobId}>
      <Loader2 className="mt-0.5 shrink-0 animate-spin text-[var(--brand)]" size={14} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold" title={job.path}>{job.title}</div>
        <div className="text-[var(--muted-foreground)]">{job.phase}{job.progress.total > 0 && ` · ${job.progress.page}/${job.progress.total} ${t("페이지")}`}</div>
        {job.performance && <div className="text-[var(--muted-foreground)]">{PDF_OCR_MODEL_LABELS[job.performance.modelVariant]} · {pdfOcrProviderLabel(job.performance.gpuProvider)}</div>}
      </div>
      <button type="button" className="shrink-0 rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50" disabled={job.cancelPending} onClick={() => void actions.stopPdfOcrJob(job.jobId)}>{job.cancelPending ? t("중단 중") : t("중단")}</button>
    </div>)}
    {(fullProgress || benchmark) && <div className="flex items-start gap-2 rounded-lg bg-[var(--muted)] p-2 text-xs">
      <Loader2 className="mt-0.5 shrink-0 animate-spin text-[var(--brand)]" size={14} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{ocr.pdfOcrPhase}</div>
        <div className="text-[var(--muted-foreground)]">{fullProgress ? `${fullProgress.page}/${fullProgress.total} ${fullProgress.unit === "file" ? "PDF" : t("페이지")}` : `${PDF_OCR_MODEL_LABELS[benchmark!.modelVariant]} ${benchmark!.modelIndex}/${benchmark!.modelTotal} · ${t("후보")} ${benchmark!.candidate}/${benchmark!.candidateTotal}`}</div>
        {fullProgress && ocr.pdfOcrPerformance && <div className="text-[var(--muted-foreground)]">{PDF_OCR_MODEL_LABELS[ocr.pdfOcrPerformance.modelVariant]} · {pdfOcrProviderLabel(ocr.pdfOcrPerformance.gpuProvider)}</div>}
      </div>
      <button type="button" className="shrink-0 rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50" disabled={ocr.pdfOcrCancelPending} onClick={() => void (fullProgress ? actions.stopFullPdfOcr() : actions.stopBenchmarkPdfOcr())}>{ocr.pdfOcrCancelPending ? t("중단 중") : t("중단")}</button>
    </div>}
  </section>
}
