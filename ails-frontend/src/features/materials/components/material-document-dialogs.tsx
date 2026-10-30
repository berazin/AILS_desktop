import type { InteractionRunner } from "../../code-sandbox/hooks/use-interaction-runner.ts"
import type { MaterialDocumentWorkflows } from "../hooks/use-material-document-workflows.ts"
import type { PdfController } from "../../pdf/hooks/use-pdf-controller.ts"
import { titleFromPath } from "../../../lib/viewer-document.ts"
import { LibreOfficeInstallDialog } from "./libreoffice-install-dialog.tsx"
import { LinkedMarkdownWindow } from "../../document/components/document-windows.tsx"
import { PdfPasswordDialog } from "../../pdf/components/pdf-password-dialog.tsx"
import { PresentationOpenProgressCard } from "./presentation-open-progress-card.tsx"

type MaterialDocumentDialogsProps = {
  isBusy: InteractionRunner["isBusy"]
  mode: "blocking" | "linked"
  pdf: PdfController
  workflow: MaterialDocumentWorkflows
}

export function MaterialDocumentDialogs({ isBusy, mode, pdf, workflow }: MaterialDocumentDialogsProps) {
  const {
    libreOfficeInstallError,
    pendingLibreOfficeFilePath,
    pendingPdfPasswordPath,
    pdfPasswordDraft,
    pdfPasswordError,
    setLibreOfficeInstallError,
    setPdfPasswordDraft,
    setPdfPasswordError,
    setPendingLibreOfficeFilePath,
    setPendingPdfPasswordPath,
  } = pdf.document

  if (mode === "linked") {
    return workflow.linkedMarkdownWindow ? (
      <LinkedMarkdownWindow
        document={workflow.linkedMarkdownWindow}
        onClose={workflow.closeLinkedMarkdown}
        onOpenInViewer={workflow.openLinkedMarkdownInViewer}
        onOpenLocalMarkdown={workflow.openLinkedMarkdown}
      />
    ) : null
  }

  return (
    <>
      {workflow.presentationOpenProgress && (
        <PresentationOpenProgressCard progress={workflow.presentationOpenProgress} />
      )}
      <PdfPasswordDialog
        busy={Boolean(pendingPdfPasswordPath && isBusy(`pdf-unlock-${pendingPdfPasswordPath}`))}
        error={pdfPasswordError}
        onCancel={() => {
          setPendingPdfPasswordPath("")
          setPdfPasswordDraft("")
          setPdfPasswordError("")
        }}
        onPasswordChange={(value) => {
          setPdfPasswordDraft(value)
          if (pdfPasswordError) setPdfPasswordError("")
        }}
        onSubmit={() => void workflow.submitPdfPassword()}
        password={pdfPasswordDraft}
        path={pendingPdfPasswordPath}
        title={titleFromPath(pendingPdfPasswordPath)}
      />
      <LibreOfficeInstallDialog
        busy={isBusy("libreoffice-install")}
        error={libreOfficeInstallError}
        onCancel={() => {
          setPendingLibreOfficeFilePath("")
          setLibreOfficeInstallError("")
        }}
        onInstall={() => void workflow.installLibreOfficeAndReopenPresentation()}
        path={pendingLibreOfficeFilePath}
        title={titleFromPath(pendingLibreOfficeFilePath)}
      />
    </>
  )
}
